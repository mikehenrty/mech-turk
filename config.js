let cache = null;
module.exports = function(cb) {
  if (cache) {
    cb(cache);
  }
  let jsonfile = require('jsonfile');
  jsonfile.readFile(__dirname + '/config.json', (err, config) => {
    if (err) {
      console.error('error loading config.json', err);
      cb({});
      return;
    }

    cache = config;
    cb(cache);
  });
};
