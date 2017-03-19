var util = require('util');
var AWS = require('aws-sdk');

AWS.config.loadFromPath('./config.json');

fs = require('fs');

/* 
Use the Amazon Mechanical Turk Sandbox to publish test Human Intelligence Tasks (HITs) without paying any money.
Sign up for a Sandbox account at https://requestersandbox.mturk.com/ with the same credentials as your main MTurk account.
*/

var endpoint = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';
// Uncomment this line to use in production
// endpoint = 'https://mturk-requester.us-east-1.amazonaws.com';

// Connect to sandbox
var mturk = new AWS.MTurk({ endpoint: endpoint });

// Test your ability to connect to MTurk by checking your account balance
// mturk.getAccountBalance(function(err, data){
//     if(err)
//         console.log(err.message)
//     else
//         // Sandbox balance check will always return $10,000
//         console.log("I have " + data.AvailableBalance + " in my account.");
// })

/*
Publish a new HIT to the Sandbox marketplace start by reading in the HTML markup specifying your task from a seperate file (my_question.xml). To learn more about the HTML question type, see here: http://docs.aws.amazon.com/AWSMechTurk/latest/AWSMturkAPI/ApiReference_HTMLQuestionArticle.html
*/

fs.readFile('my_question.xml', 'utf8', function (err,my_question) {
    if (err) {
        return console.log(err);
    };

    // Construct the HIT object below
    var myhit = {
        Title:"harpua",
        Description:"i come from a land of lizards",
        MaxAssignments: 1,
        LifetimeInSeconds: 3600,
        AssignmentDurationInSeconds: 600,
        Reward:'0.05',
        Question:my_question,

        // Add a qualification requirement that the Worker must be either in Canada or the US 
        QualificationRequirements:[{
            QualificationTypeId:'00000000000000000071',
            Comparator: "In",
            LocaleValues: [{Country:'US'}]
        }]
    }

    // Publish the object created above
    mturk.createHIT(myhit,function(err, data)
    {
        if(err)
            console.log(err.message);
        else{
            console.log(data);
            // Save the HITId printed by data.HIT.HITId and use it in the RetrieveAndApproveResults.js code sample
            // TODO: fingure out how to delete these: data.HIT.HITId
            console.log(
              "https://workersandbox.mturk.com/mturk/preview?groupId=" + 
               data.HIT.HITTypeId);
        }
    })
});
