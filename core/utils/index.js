const { existsSync } = require("fs");

/**
 * 统一路径分隔符
 * 主要为了后续生成模块ID方便
 * @param {*} path
 * @returns
 */
function toUnixPath(path) {
  return path.replace(/\\/g, '/');
}

/**
 * @param {*} modulePath 模块绝对路径
 * @param {*} extensions 扩展名数组
 * @param {*} originModulePath 原始引入模块路径
 * @param {*} moduleContext 模块上下文（当前模块所在目录）
 */
function tryExtensions(modulePath, extensions, originModulePath, moduleContext) {
  // 优先尝试不需要扩展名选项
  extensions.unshift('');
  for (const extension of extensions) {
    if (existsSync(modulePath + extension)) {
      return modulePath + extension
    }
  }
  // 未匹配对应文件
  throw new Error(`No module, Error: can't resolve ${originModulePath} in ${moduleContext}`);
}

/**
 * 获取chunk的源代码
 */
function getSourceCode(chunk) {
  const {name, entryModule, modules} = chunk;
  return `
    (() => {
      var __webpack_modules__ = {
        ${
          modules.map(module => {
            return `'${module.id}': module => {
              ${module._source}
            }`
          }).join(',')
        }
      };
      // the module cache
      var __webpack_module_cache__ = {};

      // the require function 
      function __webpack_require__(moduleId) {
        // check if module is in cache
        var cachedModule = __webpack_module_cache__[moduleId];
        if (cachedModule !== undefined) {
          return cachedModule.exports;
        }
        // create a new module, and put it into the cache
        var module = (__webpack_module_cache__[moduleId] = {
          exports: {}
        });
        // execute the module function
        __webpack_modules__[moduleId](module, module.exports, __webpack_require__)；
        // return the exports of the module
        return module.exports;
      }

      var __webpack_exports__ = {}；
      // this entry needs to be wrapped in an IIFE, because id need to be 
      // isolated against other modules in the chunks.
      (() => {
        ${entryModule._source}
      })()
    })()
  `
}

module.exports = {
  toUnixPath,
  tryExtensions,
  getSourceCode
}