(function() {
  'use strict';

  const DEFAULTS = {
    "accessKeyId": "",     // AWS creds.
    "secretAccessKey": "", // AWS creds.
    "region": "us-east-1",
    "uploadHost": "", // Server where site lives.
    "uploadDest": "/home/mikehenrty/mech-turk/",
    "DB_USER": "", // Mongo instance.
    "DB_PASS": "",
    "DB_NAME": "",
    "DB_PORT": 0,
    "PROD": false  // Run HITs on production or sandbox.
  };


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

      cache = Object.assign({}, DEFAULTS, config);
      cb(cache);
    });
  };
})();
