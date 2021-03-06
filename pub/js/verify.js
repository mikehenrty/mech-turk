var $ = document.querySelector.bind(document);
var SOUNDCLIP_URL = '/upload/';
var VERIFY_URL = '/verify/';

var SANDBOX_URL = 'https://workersandbox.mturk.com';
var SANDBOX_ACTION = SANDBOX_URL + '/mturk/externalSubmit';

var MSG_LISTEN = 'Please listen to the clip before submitting';
var MSG_CHECKED = 'Please select an option to submit';

var played = false;

function getQuery() {
  if (window._query) {
    return window._query;
  }
  var query = location.search.substr(1);
  var result = {};
  query.split("&").forEach(function(part) {
    var item = part.split("=");
    result[item[0]] = decodeURIComponent(item[1]);
  });
  window._query = result;
  return result;
}

function setMessage(message) {
  var m = $('#message');
  m.textContent = message;
  m.className = 'panel';
}

function clipWasPlayed() {
  return played;
}

function getSelectedAnswer() {
  var list = document.querySelectorAll('input[type="radio"]:checked');
  if (list.length < 1) {
    return null;
  }
  return list[0];
}

function isFormReadyToSubmit() {
  return !!getSelectedAnswer();
}

function validateForm() {
  if (!clipWasPlayed()) {
    setMessage(MSG_LISTEN);
    $('#clip').className = 'highlight';
    return false;
  }

  if (!isFormReadyToSubmit()) {
    setMessage(MSG_CHECKED);
    $('.answers').className = 'answers highlight';
    return false;
  }

  $('#submit-btn').className = 'active';
  return true;
}

// Tell server about answer.
function verifyClip(cb) {
  var query = getQuery();
  var req = new XMLHttpRequest();
  req.addEventListener('load', cb);
  req.addEventListener('error', cb);
  req.open('POST', VERIFY_URL);
  req.setRequestHeader('hitid', query.hitId);
  req.setRequestHeader('uid', query.workerId);
  req.setRequestHeader('assignmentid', query.assignmentId);
  req.setRequestHeader('previousworkerid', query.previousworkerid);
  req.setRequestHeader('verifyid', query.verifyid);
  req.setRequestHeader('answer', getSelectedAnswer().value);
  req.send(query.assignmentId);
}

function onLoad() {
  var query = getQuery();
  console.log('**', query);

  // Use sandbox form action in sandbox mode.
  if (query.turkSubmitTo === SANDBOX_URL) {
    $('form').action = SANDBOX_ACTION;
  }

  if (query.assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
    return;
  }

  var clip = document.getElementById('clip');
  clip.src = SOUNDCLIP_URL + query.previousworkerid + '/' +  query.verifyid;
  clip.addEventListener('ended', function() {
    played = true;
    $('.answers').className = 'answers'; // Remove disabled.
  });

  $('#original-excerpt').textContent = '"' + query.excerpt +'"';
  $('[name=previousworkerid]').value = query.previousworkerid;
  $('[name=previousassignmentid]').value = query.verifyid;
  $('[name=assignmentId]').value = query.assignmentId;

  var m = $('#message');
  m.className = 'panel disabled';
  var o = $('#overlay');
  o.className = 'disabled';

  // Update form after each radio button click.
  var r = document.querySelectorAll('input[type="radio"]');
  for (var i = 0; i < r.length; i++) {
    r[i].onclick = validateForm;
  }

  // Validate form before allowing submit.
  var s = $('#submit-btn');
  s.addEventListener('click', function() {
    if (!validateForm()) {
      return false;
    }

    verifyClip(function() {
      var f = $('form');
      f.submit();
    });
    return true;
  });

}

document.addEventListener('DOMContentLoaded', onLoad);
