'use strict';

/**
 * Express 4 tidak menangkap rejection dari handler async.
 * Wrapper ini meneruskan error ke error middleware terpusat.
 */
module.exports = function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
