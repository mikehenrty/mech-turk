(function() {
  'use strict';

  const mongo = require('./mongo');
  const workers = require('./workers');
  const sentences = require('./sentences');

  let ff = require('ff');

  function run(cb) {
    let f = ff(() => {
      sentences.create(f());
      workers.create(f());
    });

    f.onComplete((err) => {
      if (err) {
        console.error('could not create db', err);
      } else {
        console.log('database created');
      }

      mongo.disconnect();
      if (cb) { cb(); }
    });
  }

  // If this was run from cli, immediately invoke run.
  if (require.main === module) {
    run(() => {
      process.exit(0);
    });
  } else {
    module.exports = run;
  }
})();
