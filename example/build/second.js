
    (() => {
      var __webpack_modules__ = {
        
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
        const depModule = __webpack_require__("./example/src/module.js");

console.log(depModule, 'dep');
console.log('This is entry 2 !');
const loader2 = 'tianwang8090';
const loader1 = 'https://github.com/tianwang8090';
      })()
    })()
  