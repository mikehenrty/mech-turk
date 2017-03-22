function promisify(context, method, args) {
  if (!Array.isArray(args)) {
    args = [args];
  }

  return new Promise((resolve, reject) => {
    method.apply(context, args.concat([(err, result) => {
      if (err) {
        console.error('promise error', err);
        reject(err);
        return;
      }
      resolve(result);
    }]));
  });
}

promisify.map = function(context, method, items) {
  return Promise.all(items.map(item => {
    return method.call(context, item);
  }));
};

module.exports = promisify;
