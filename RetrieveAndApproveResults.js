var util = require('util');
var AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
// Add in the HITId below. See SubmitTask.js for generating a HIT
var my_HITId = "YOUR_HIT_ID";

var endpoint = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';
// Uncomment this line to use in production
// endpoint = 'https://mturk-requester.us-east-1.amazonaws.com';

// Connect to sandbox
var mturk = new AWS.MTurk({ endpoint: endpoint });

/* 
To keep this example simple, we are assuming that there are fewer 
than 100 results and there is no need to iterate through pages of results
*/ 

mturk.listHITs({}, function(err, hits) {
  if (err) {
    console.err('ERROR', err);
    return;
  }

  hits.HITs && hits.HITs.forEach(function (hit) {
    if (!hit.HITStatus === 'Reviewable') {
      consol.log('leaving', hit.HITId);
      return;
    }

    mturk.listAssignmentsForHIT({HITId: hit.HITId},
    function(err, assignmentsForHIT){
      if(err) {
        console.error(err.message);
        return;
      }

      console.log("Completed Assignments found: " + assignmentsForHIT.NumResults);
      for(var i = 0; i < assignmentsForHIT.NumResults; i++){
        console.log("Answer from Worker with ID - " +
            assignmentsForHIT.Assignments[i].WorkerId + ": ");
        console.log(assignmentsForHIT.Assignments[i].Answer);

        // Approve the work so the Worker is paid with
        // and optional feedback message             
        mturk.approveAssignment({
          AssignmentId: assignmentsForHIT.Assignments[i].AssignmentId,
          RequesterFeedback: "Thanks for the great work!"
        });
      }                
    });
  })
});
