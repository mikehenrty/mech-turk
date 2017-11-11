(function() {
  'use strict';

  const AWS = require('aws-sdk');
  const path = require('path');
  const fs = require('fs-extra');
  const glob = require('glob');
  const Question = require('./question');
  const promisify = require('./promisify');
  const FSHelper = require('./fs-helper');

  const CONFIG_FILE = __dirname + '/../../config.json';
  const UPLOAD_PATH = FSHelper.UPLOAD_PATH;
  const RECORDED_DIR = FSHelper.RECORDED_DIR;
  const RECORDED_PATH = FSHelper.RECORDED_PATH;
  const VERIFIED_DIR = FSHelper.VERIFIED_DIR;
  const VERIFIED_PATH = FSHelper.VERIFIED_PATH;
  const REJECTED_DIR = FSHelper.REJECTED_DIR;
  const REJECTED_PATH = FSHelper.REJECTED_PATH;

  const ENDPOINT_PROD =
    'https://mturk-requester.us-east-1.amazonaws.com';
  const ENDPOINT_DEBUG =
    'https://mturk-requester-sandbox.us-east-1.amazonaws.com';
    //  Alternative endpoint, couldn't get to work
    // 'https://mechanicalturk.sandbox.amazonaws.com';
    // 'https://mechanicalturk.amazonaws.com';

  const REGEX_FREETEXT = '<FreeText>(.*?)<\/FreeText>';
  const REGEX_QUESTION = '<QuestionIdentifier>(.*?)<\/QuestionIdentifier>';

  const DEFAULT_FEEDBACK = "Thanks for the great work!";

  const COMMANDS = {
    'help'   : 'Display this help text.',
    'balance': 'Retrieves balance that is on the account.',
    'list'   : 'List the current HITs and their status.',
    'stats'  : 'List the status of the current uploaded clips.',
    'add'    : 'Add a new voice recording HIT.',
    'process': 'Approve/delete reviewable jobs, create verify tasks.',
    'kill'   : 'Get rid of all jobs.',
    'review' : 'Review current HITs.',
    'verify' : 'Create verify hits from recorded folder.',
    'approve': 'Approve HITs.',
    'reset'  : 'Reset reviewing status back to available.',
    'expire' : 'Forcibly expire all available HITs.',
    'trim'   : 'Delete all deletable jobs.'
  };

  function printStack() {
    console.log((new Error().stack));
  }

  function countResults(results) {
    if (typeof results === 'number') {
      return results;
    }
    if (Array.isArray(results)) {
      return results.reduce((acc, result) => {
        return acc + result;
      }, 0);
    }

    console.error('could not count unrecognized results', results);
  }

  function printUrlListFromResults(results) {
    Object.keys(results.reduce((acc, hit) => {
      acc[hit.url] = true;
      return acc;
    }, {})).forEach(url => {
      console.log(url);
    });
  }

  function little(str) {
    return str.substr(0, 4) + str.substr(-4);
  }

  /**
   * MechTurk, class for handling aws mt api.
   * @production - bool, use production entpoint.
   */
  function MechTurk(config) {
    let production = config.PROD;
    AWS.config.loadFromPath(CONFIG_FILE);

    // Make sure to use appropriate endpoint.
    let endpoint = ENDPOINT_DEBUG;
    if (production) {
      endpoint = ENDPOINT_PROD;
    }

    this._mt = new AWS.MTurk({ endpoint: endpoint });
    this._question = new Question(this._mt, config);
    this._fsHelper = new FSHelper();
  }

  MechTurk.prototype._glob = function(pattern) {
    return promisify(null, glob, pattern);
  };

  MechTurk.prototype._deleteHIT = function(HITId) {
    return promisify(this._mt, this._mt.deleteHIT, { HITId: HITId });
  };

  MechTurk.prototype._getAccountBalance = function() {
    return promisify(this._mt, this._mt.getAccountBalance, {});
  };


  MechTurk.prototype._listAssignmentsForHIT = function(options) {
    options.MaxResults = options.MaxResults || 100;
    options.AssignmentStatuses = ['Submitted'];
    return promisify(this._mt, this._mt.listAssignmentsForHIT, options);
  };

  MechTurk.prototype._listHITs = function(NextToken) {
    let options = {};
    if (NextToken) {
      options.NextToken = NextToken;
    }
    return promisify(this._mt, this._mt.listHITs, options);
  };

  MechTurk.prototype._listReviewableHITs = function(NextToken) {
    let options = {};
    if (NextToken) {
      options.NextToken = NextToken;
    }
    return promisify(this._mt, this._mt.listReviewableHITs, options);
  };

  MechTurk.prototype._updatHITReviewStatus = function(id, Revert) {
    // Default to setting hit to Reviewing.
    Revert = typeof Revert === 'undefined' ? false : Revert;
    return promisify(this._mt, this._mt.updateHITReviewStatus, {
      HITId: id,
      Revert: Revert
    });
  };

  MechTurk.prototype._expireHIT = function(id) {
    return promisify(this._mt, this._mt.updateExpirationForHIT, {
      HITId: id,
      ExpireAt: 0
    });
  };

  MechTurk.prototype._approveAssignment = function(id) {
    return promisify(this._mt, this._mt.approveAssignment, {
      AssignmentId: id,
      RequesterFeedback: DEFAULT_FEEDBACK
    });
  };

  MechTurk.prototype._getSentenceFromAnswer = function(Answer) {
    // We assume the only FreeText in the answer XML is the excerpt.
    return RegExp(REGEX_FREETEXT).exec(Answer)[1];
  };

  MechTurk.prototype._getInfoFromVerify = function(Answer) {
    let answer = {};
    let reFree = new RegExp(REGEX_FREETEXT, 'g');
    let reQuestion = new RegExp(REGEX_QUESTION, 'g');

    let matchFree = reFree.exec(Answer);
    let matchQuestion = reQuestion.exec(Answer);
    while (matchFree && matchQuestion) {
      answer[matchQuestion[1]] = matchFree[1];
      matchFree = reFree.exec(Answer);
      matchQuestion = reQuestion.exec(Answer);
    }

    return answer;
  };

  MechTurk.prototype._getAssigments = function(NextToken) {
    let assignments = [];
    let results = null;

    return this._listReviewableHITs(NextToken)
      .then(r => {
        results = r;
        let hits = results.HITs.map(hit => {
          return {
            HITId: hit.HITId
          };
        });
        return promisify.map(this, this._listAssignmentsForHIT, hits);
      })

      .then(r => {
        r.forEach(hit => {
          assignments = assignments.concat(hit.Assignments);
        });

        return {
          assignments: assignments,
          NextToken: results.NextToken
        };
      });
  };
  MechTurk.prototype._runOnAllHits = function(method, NextToken) {
    return this._listHITs(NextToken)
      .then(results => {
        let hits = results.HITs;
        let next = results.NextToken;

        return promisify.map(this, method, hits)
          .then(results => {
            if (!next) {
              return hits.length;
            }

            return this._runOnAllHits(method, next).then(r => {
              return hits.length + r;
            });
          });
      });
  };

  MechTurk.prototype._reviewAll = function(recordType, verifyType, NextToken) {
    return Promise.all([
      recordType || this._question.getRecordHitType(),
      verifyType || this._question.getVerifyHitType(),
      this._listHITs(NextToken)
    ])

      .then(results => {
        recordType = results[0];
        verifyType = results[1];
        let hitResults = results[2];

        let next = hitResults.NextToken;
        let hits = hitResults.HITs.filter(hit => {
          return hit.HITStatus === 'Reviewable';
        });

        return this._processHits(hits, recordType, verifyType)
          .then((results) => {
            if (next) {
              return this._reviewAll(recordType, verifyType, next)
                .then(r => {
                  return countResults(results) + countResults(r);
                });
            }

            return countResults(results);
          });
      });
  };

  MechTurk.prototype._processRecord = function(HITId, assignments) {
    let params = assignments.map(a => {
      return {
        HITId: HITId,
        AssignmentId: a.AssignmentId,
        WorkerId: a.WorkerId,
        excerpt: this._getSentenceFromAnswer(a.Answer)
      };
    });

    return promisify.map(this._question, this._question.addVerify, params)
      .then(results => {
        return results.length;
      });
  };

  MechTurk.prototype._processVerify = function(assignments) {
    // Extract the answers from the submitted jobs.
    let answers = assignments.map(assignment => {
      return {
        HITId: assignment.HITId,
        id: assignment.AssignmentId,
        answer: this._getInfoFromVerify(assignment.Answer)
      };
    });

    // Process each answer.
    return promisify.map(this, results => {
      let AssignmentId = results.id;
      let answer = results.answer;
      let pattern = path.resolve(RECORDED_PATH, answer.previousworkerid,
        answer.previousassignmentid + '.*');
      return this._glob(pattern)

        .then(files => {
          let destination;
          files = files || [];

          // Decide where to put the sound clip based on answer.
          if (answer.answer === 'yes') {
            destination = path.resolve(VERIFIED_PATH, answer.previousworkerid);
          } else if (answer.answer === 'no' || answer.answer === 'bad') {
            destination = path.resolve(REJECTED_PATH, answer.previousworkerid);
          } else {
            console.error('unrecognized answer', answer.answer);
            throw 'Unrecognized verify answer: ' + answer.answers;
          }

          // Move the sound clips to their destination.
          return promisify.map(this, f => {
            let p = path.resolve(destination, path.basename(f));
            return promisify(fs, fs.move, [f, p]);
          }, files)

            .then(r => {
              if (files.length === 0) {
                console.log('voice clip no found, discarded', little(results.HITId));
              } else if (answer.answer === 'yes') {
                console.log('voice clip accepted', little(results.HITId));
              } else {
                console.log('sound rejected', little(results.HITId));
              }

              return this._approveAssignment(AssignmentId);
            });
        });
    }, answers)

      .then(results => {
        return results.length;
      });
  };

  MechTurk.prototype._approveAssignmentsForHit = function(HITId, NextToken) {
    let count = 0;
    let next;

    return this._listAssignmentsForHIT({
      HITId: HITId,
      NextToken: NextToken
    })

      .then(results => {
        next = results.NextToken;
        let assignments = results.Assignments.map(a => {
          return a.AssignmentId;
        });
        return promisify.map(this, this._approveAssignment, assignments);
      })

      .then(results => {
        count += results.length;
        if (next) {
          return this._approveAssignmentsForHit(HITId, next);
        }
      })

      .then(results => {
        return count + (results || 0);
      });
  };

  MechTurk.prototype._finalizeVerify = function(verifyId, recordId) {
    return Promise.all([
      this._deleteHIT(verifyId),
      this._approveAssignmentsForHit(recordId)
    ])

      .then(() => {
        return this._deleteHIT(recordId);
      });
  };

  MechTurk.prototype._processHits = function(hits, recordType, verifyType) {
    return promisify.map(this, hit => {
      let HITId = hit.HITId;
      let HITTypeId = hit.HITTypeId;
      let count = 0;

      // We need createVerifyHITs as an entrypoint for psuedo recursion.
      // This will process all assignments for hit.
      return (function createVerifyHITs(NextToken) {
        let results;

        return this._listAssignmentsForHIT({
          HITId: HITId,
          NextToken: NextToken
        })

          .then(r => {
            results = r;
            if (HITTypeId === recordType) {
              return this._processRecord(HITId, results.Assignments);
            } else if (HITTypeId === verifyType) {
              return this._processVerify(results.Assignments);
            } else {
              console.error('Unrecognized hit type', hit);
              throw 'Unrecognized hit: ' + little(hit.HITId);
            }
          })

          .then(results => {
            count += results;
            if (results.NextToken) {
              return createVerifyHITs.call(this, results.NextToken);
            }
          })

          .then(results => {
            return count + (results || 0);
          });
      }).call(this)

        .then(processed => {
          if (processed < 1) {
            return processed;
          }

          if (HITTypeId === recordType) {
            return this._updatHITReviewStatus(HITId, false).then(t=> {
              return processed;
            });
          } else if (HITTypeId === verifyType) {
            return this._finalizeVerify(HITId, hit.RequesterAnnotation)
              .then(t=> {
                return processed;
              });
          }
        });
    }, hits);
  };

  /* jshint ignore:start */
  MechTurk.prototype._approveAll = async function(NextToken) {
    let count = 0;

    do {
      const results = await this._getAssigments(NextToken);
      NextToken = results.NextToken;
      const assignments = results.assignments;

      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i];
        const assignmentId = assignment.AssignmentId;
        await this._approveAssignment(assignmentId);
        ++count;
      }

    } while (NextToken);

    return count;
    // let assignments, next;

    // return this._getAssigments(NextToken)
    //   .then(async function(data) {
    //     console.log('got some assignments', data);
    //     assignments = data.assignments;
    //     next = data.NextToken;

    //     for (let i = 0; i < assignments.length; i++) {
    //       const assignmentId = assignments[i].AssignmentId;
    //       const thing = await promisify(this, this._approveAssignment, assignmentId);
    //       console.log(thing);
    //     }
    //   }.bind(this))

    //   .then(() => {
    //     if (!next) {
    //       console.log('returning', assignments);
    //       return assignments.length;
    //     }

    //     return this._approveAll(next).then(r => {
    //       return assignments.length + r;
    //     });
    //   });
  };
  /* jshint ignore:end */

  MechTurk.prototype.expire = function() {
    let count = 0;
    return this._runOnAllHits(hit => {
      return this._expireHIT(hit.HITId)
        .then(results => {
          ++count;
          return results;
        });
    }).then(() => {
      console.log(`expired ${count} HITs`);
    });
  };

  MechTurk.prototype.approve = function() {
    return this._approveAll()
      .then(approved => {
        console.log(`approved ${approved} assignments`);
      });
  };

  /* jshint ignore:start */
  MechTurk.prototype.kill = async function() {
    await this.approve();
    await this.expire();
    await this.trim();
  };

  MechTurk.prototype.review = function() {
    console.error('just approve these jobs and create a way to create validate jobs separately');
    return;

    // return this._reviewAll().then(reviewed => {
    //   if (reviewed < 1) {
    //     console.log('no reviewable jobs');
    //     return;
    //   }
    //   console.log('reviewed jobs', reviewed);
    // });
  };

  MechTurk.prototype.verify = async function() {
    const recorded = await this._fsHelper.getVerifiable();
    let results = [];

    for (let i = 0; i < recorded.length; i++) {
      const r = recorded[i];
      const result = await this._question.addVerifyRaw(
        r.hitId,
        r.workerId,
        r.assignmentId,
        r.sentence
      );
      results.push(result);
      await this._fsHelper.markVerify(
          r.workerId, r.assignmentId, result.HITId);
    }
    printUrlListFromResults(results);
    console.log('created verify jobs', recorded.length);

    // Move any verified or rejected clips.
    let verified = 0;
    let rejected = 0;
    const clips = await this._fsHelper.listClips();
    for(let i = 0; i < clips.length; i++) {
      const c = clips[i];

      // We only care about non reviewed clips.
      if (c.type !== RECORDED_DIR) {
        continue;
      }

      if (c.good >= Question.VERIFY_MAJORITY) {
        ++verified;
        await this._fsHelper.verifyGood(c.workerId, c.assignmentId);
      } else if (c.bad >= Question.VERIFY_MAJORITY) {
        ++rejected;
        await this._fsHelper.verifyBad(c.workerId, c.assignmentId);
      }
    }

    if (verified > 0) {
      console.log('verified clips', verified);
    }
    if (rejected > 0) {
      console.log('rejected clips', rejected);
    }
  };

  MechTurk.prototype.process = async function() {
    await this.approve();
    await this.trim();
    await this.verify();
    await this.list();
  };
  /* jshint ignore:end */

  MechTurk.prototype.reset = function() {
    let count = 0;
    return this._runOnAllHits(hit => {
      if (hit.HITStatus === 'Reviewing') {
        ++count;
        return this._updatHITReviewStatus(hit.HITId, true);
      }
    }).then(results => {
      console.log(`reset ${count} out of ${results} HITs`);
    });
  };

  MechTurk.prototype._deleteReviewable = function(NextToken) {
    let deleted = 0;
    let next;

    return this._listHITs(NextToken)
      .then(hits => {
        next = hits.NextToken;

        return promisify.map(this, hit => {
          // Don't delete hits with that are open or in-review.
          if (hit.HITStatus === 'Reviewing' ||
              hit.HITStatus === 'Unassignable' ||
              hit.HITStatus === 'Assignable') {
            return;
          }

          // Make sure HIT we are deleting has all it's submitted
          // asssigments already reviewed.
          if ((hit.NumberOfAssignmentsCompleted +
              hit.NumberOfAssignmentsAvailable) !== hit.MaxAssignments) {
            return;
          }

          return this._deleteHIT(hit.HITId).then(() => {
            ++deleted;
          }).catch(e => {
            console.error('del error', e.message);
          });
        }, hits.HITs);
      })

      .then(() => {
        if (next) {
          return this._deleteReviewable(next);
        }
      })

      .then(r => {
        return deleted;
      });
  };

  MechTurk.prototype.trim = function() {
    return this._deleteReviewable()
      .then(results => {
        console.log('deleted jobs', results);
      });
  };

  MechTurk.prototype._listAll = function(recordType, verifyType, NextToken) {
    let count = 0;

    return this._listHITs(NextToken).then(hits => {
      let left = hits.HITs.filter(hit => {
        let type = 'Unrecognized-' + hit.HITTypeId;
        if (hit.HITTypeId === recordType) {
          type = 'Recording';
        } else if (hit.HITTypeId === verifyType) {
          type = 'Verifying';
        }

        let pending = hit.NumberOfAssignmentsPending;
        let available = hit.NumberOfAssignmentsAvailable;
        let completed = hit.NumberOfAssignmentsCompleted;

        let now = Date.now();
        let then = +(new Date(hit.Expiration));
        let expired = now - then > 0 ? 'Expired' : 'Fresh';

        console.log(little(hit.HITId), type, hit.HITStatus, expired,
          pending, 'pending',
          available, 'available',
          completed, 'completed');
        ++count;
      });

      if (hits.NextToken) {
        return this._listAll(recordType, verifyType, hits.NextToken);
      }
    })

      .then(results => {
        return count + (results || 0);
      });
  };

  MechTurk.prototype.list = function() {
    return Promise.all([
      this._question.getRecordHitType(),
      this._question.getVerifyHitType(),
    ])

      .then(results => {
        let recordType = results[0];
        let verifyType = results[1];
        return this._listAll(recordType, verifyType);
      })

      .then(count => {
        if (count === 0) {
          console.log('no current hits');
        }

        // Now print upload file stats.
        return this.stats();
      });
  };

  MechTurk.prototype.add = function(count) {
    // Default to add 1 record HIT.
    count = typeof count === 'undefined' ? 1 : count;
    let promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(this._question.add());
    }
    return Promise.all(promises)
      .then(results => {
        // Print any new group urls.
        printUrlListFromResults(results);
        console.log('new jobs created', results.length);
      });
  };

  MechTurk.prototype.help = function() {
    console.log('\nUsage: turk [command]');
    Object.keys(COMMANDS).forEach(command => {
      console.log(`  ${command}   \t- ${COMMANDS[command]}`);
    });
    console.log();
    return Promise.resolve();
  };

  /* jshint ignore:start */
  MechTurk.prototype.stats = async function() {
    let rec = 0;
    let rev = 0;
    let ver = 0;
    let rej = 0;
    const clips = await this._fsHelper.listClips();

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c.type === RECORDED_DIR) {
        if (c.verifying) {
          ++rev;
        } else {
          ++rec;
        }
      } else if (c.type === VERIFIED_DIR) {
        ++ver;
      } else if (c.type === REJECTED_DIR) {
        ++rej;
      } else {
        console.error('unrecognized text file', root, fileStats.name);
      }
    }

    console.log(
      `--> ${rec} unverified --> ${rev} in-review --> ${ver} good --> ${rej} bad`
    );
  };
  /* jshint ignore:end */

  MechTurk.prototype.balance = function() {
    return this._getAccountBalance().then(results => {
      console.log('you have:', results.AvailableBalance);
    });
  };

  MechTurk.prototype.runCommand = function(command, parameter) {
    if (!COMMANDS[command]) {
      console.log('Unrecognized command', command);
      this.help();
      return Promise.resolve();
    }

    if (typeof this[command] !== 'function') {
      console.error('Error, undefined function for command', command);
      return Promise.reject('unrec command:' + command);
    }


    /*
    // Debug output for funning server commands.
    // Runs prints list before and after command.
  if (command !== 'list' && command !== 'stats') {
    return this.list().then(results => {
      return this[command](parameter);
    }).then(results => {
      return this.list();
    });
  }
  */

    return this[command](parameter);
  };

  module.exports = MechTurk;
})();
