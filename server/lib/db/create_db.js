(function() {
  'use strict';

  const mongo = require('./mongo');
  const Workers = require('./workers');

  let ff = require('ff');

  function run(cb) {
    let f = ff(() => {
      Workers.create(f());
    });

    f.onComplete((err) => {
      if (err) {
        console.error('could not create db', err);
      } else {
        console.log('welp, looks like that worked.');
      }

      mongo.disconnect();
      if (cb) { cb(); }
    });
  }

  // If this was run from cli, immediately invoke run.
  if (require.main === module) {
    run();
  } else {
    module.exports = run;
  }
})();
