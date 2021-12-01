const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('fs');
const path = require('path');
const {SyncHook} = require('tapable');
const {toUnixPath} = require('./utils/index');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');
const {tryExtensions, getSourceCode} = require('./utils/index');

class Compiler {
  constructor(options) {
    this.options = options;
    // 相对路径根路径Context参数
    this.rootPath = toUnixPath(this.options.context || process.cwd());
    // 创建plugin hooks
    this.hooks = {
      // 开始编译时的钩子
      run: new SyncHook(),
      // 输出asset 到 output 目录之前执行（写入文件之前）
      emit: new SyncHook(),
      // 在compilation 完成时执行，全部完成编译执行
      done: new SyncHook()
    };
    // 所有入口模块对象
    this.entries = new Set();
    // 所有依赖模块对象
    this.modules = new Set();
    // 多有代码块对象
    this.chunks = new Set();
    // 本次产出的文件对象
    this.assets = new Map();
    // 本次编辑产出的文件名
    this.files = new Set();
  }

  /**
   * 启动编译
   * 同时接收外部传递的callback
   */
  run(callback) {
    this.hooks.run.call();
    // 获取入口配置对象
    const entry = this.getEntry();
    // 编译入口文件
    this.buildEntryModule(entry);
    // 导出列表，之后将每个chunk转化为单独的文件，加入到assets中
    this.exportFile(callback);
  }

  /**
   * 获取入口文件路径
   */
  getEntry() {
    let entry = Object.create(null);
    const {entry: optionsEntry} = this.options;
    
    if (typeof optionsEntry === 'string') {
      entry.main = optionsEntry;
    } else {
      entry = optionsEntry;
    }

    // 转换为绝对路径
    Object.keys(entry).forEach(key => {
      const value = entry[key];
      if (!path.isAbsolute(value)) {
        entry[key] = path.join(this.rootPath, value)
      }
      entry[key] = toUnixPath(entry[key])
    })

    return entry;
  }

  /**
   * 编译入口文件
   */
  buildEntryModule(entry) {
    Object.keys(entry).forEach(entryName => {
      const entryPath = entry[entryName];
      const entryObj = this.buildModule(entryName, entryPath);
      this.entries.add(entryObj);
      // 根据当前入口文件和模块的相互依赖关系，组装成为一个个包含当前入口所有依赖的chunk
      this.buildChunk(entryName, entryObj);
    });
  }

  /**
   * 模块编译方法
   */
  buildModule(moduleName, modulePath) {
    // 1. 读取文件源代码
    const originSourceCode = (this.originSourceCode = readFileSync(modulePath, 'utf-8'));
    // moduleCode 为修改后的代码
    this.moduleCode = originSourceCode;
    // 2. 调用loader 进行处理
    this.handleLoader(modulePath);
    // 3. 调用webpack进行模块编译，获得最终的module对象
    const module = this.handleWebpackCompiler(moduleName, modulePath);
    // 4. 返回对应module
    return module;
  }

  /**
   * 匹配loader处理
   */
  handleLoader(modulePath) {
    const matchLoaders = [];
    // 1. 获取所有传入的loader规则
    const rules = this.options.module.rules;
    rules.forEach(loader => {
      const testRule = loader.test;
      if (testRule.test(modulePath)) {
        // 仅考虑loader 
        // { test: /\.js$/, use: ['babel-loader'] }  
        // { test:/\.js$/, loader:'babel-loader' }
        if (loader.loader) {
          matchLoaders.push(loader.loader);
        } else {
          matchLoaders.push(...loader.use);
        }
      }
    })
    for (let i = matchLoaders.length - 1; i >= 0; i--) {
      // 目前仅支持传入绝对路径的loader
      const loaderFn = require(matchLoaders[i]);
      // 通过loader 同步处理每一次编译的 moduleCode
      this.moduleCode = loaderFn(this.moduleCode);
    }
  }

  /**
   * 调用webpack进行模块编译
   */
  handleWebpackCompiler(moduleName, modulePath) {
    // 将当前模块相对于项目启动根目录计算出相对路径，作为模块ID
    const moduleId = './' + toUnixPath(path.relative(this.rootPath, modulePath));
    // 创建模块对象
    const module = {
      id: moduleId,
      dependencies: new Set(), // 该模块所依赖模块绝对路径地址
      name: [moduleName] // 该模块所属入口文件
    };
    // 调用babel分析代码
    const ast = parser.parse(this.moduleCode, {sourceType: 'module'});
    // 深度优先，遍历语法Tree
    traverse(ast, {
      CallExpression: nodePath => {
        const node = nodePath.node;
        if (node.callee.name === 'require') {
          // 获得源代码中引入模块相对路径
          const moduleName = node.arguments[0].value;
          // 寻找模块绝对路径：当前模块路径 + require() 相对路径
          const moduleDirName = path.posix.dirname(modulePath);
          const absolutePath = tryExtensions(
            path.posix.join(moduleDirName, moduleName),
            this.options.resolve.extensions,
            moduleName,
            moduleDirName
          );
          // 生成moduleId: 针对于根路径的模块ID，添加进入新的依赖模块路径
          const moduleId = './' + path.posix.relative(this.rootPath, absolutePath);
          // 通过babel 修改源代码中的require 变成 __webpack_require__ 语句
          node.callee = t.identifier('__webpack_require__');
          // 修改源代码中require 语句引入的模块，全部修改为相对于根路径来处理
          node.arguments = [t.stringLiteral(moduleId)];
          // 转换为ids数组，方便处理
          const alreadyModules = Array.from(this.modules).map(i => i.id);
          if (!alreadyModules.includes(moduleId)) {
            // 为当前模块添加require 语句造成的依赖（内容为相对于根路径的模块ID）
            module.dependencies.add(moduleId)
          } else {
            // 已经存在的话，则不进行模块编译，但仍要更新模块依赖的入口
            this.modules.forEach(module => {
              if (module.id === moduleId) {
                module.name.push(moduleName);
              }
            })
          }
        }
      }
    });
    // 遍历结束，根据AST生成新代码
    const {code} = generator(ast);
    // 为当前模块挂载新的代码
    module._source = code;
    // 递归依赖深度遍历， 存在依赖模块则加入
    module.dependencies.forEach(dependency => {
      const depModule = this.buildModule(moduleName, dependency);
      // 将编译后的任何依赖模块对象加入到modules对象中去
      this.modules.add(depModule);
    })
    // 返回当前模块对象
    return module;
  }

  /**
   * 根据当前入口文件和模块的相互依赖关系，组装成为一个个包含当前入口所有依赖的chunk
   */
  buildChunk(entryName, entryObj) {
    const chunk = {
      name: entryName, // 每个入口文件作为一个chunk
      entryModule: entryObj, // entry 编译后的对象
      modules: Array.from(this.modules).filter(module => module.name.includes(entryName)) // 寻找与当前entry有关的所有module
    };
    // 将chunk添加到this.chunks
    this.chunks.add(chunk);
  }

  /**
   * 将chunk添加到输出列表中
   */
  exportFile(callback) {
    const output = this.options.output;
    // 根据chunks生成assets内容
    this.chunks.forEach(chunk => {
      const parseFileName = output.filename.replace('[name]', chunk.name);
      // assets 中 {'main.js': '生成的字符串代码...'}
      this.assets.set(parseFileName, getSourceCode(chunk));
    });
    // 调用Plugin emit 钩子
    this.hooks.emit.call();
    // 先判断输出目录是否存在，存在则直接写入，不存在则先创建
    if (!existsSync(output.path)) {
      mkdirSync(output.path);
    }
    // files 中保存所有生成的文件名名
    this.files = this.assets.keys();
    // 将assets 中的内容生成打包文件，写入文件系统中
    this.assets.forEach((asset, filename) => {
      const filePath = path.join(output.path, filename);
      writeFileSync(filePath, asset);
    });
    // 结束之后触发钩子
    this.hooks.done.call();
    callback(null, {
      toJson: () => {
        return {
          entries: this.entries,
          modules: this.modules,
          files: this.files,
          assets: this.assets,
          chunks: this.chunks
        }
      }
    });
    
  }

}

module.exports = Compiler;