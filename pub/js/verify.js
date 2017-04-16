var $ = document.querySelector.bind(document);
var SOUNDCLIP_URL = '/upload/';

var SANDBOX_URL = 'https://workersandbox.mturk.com';
var SANDBOX_ACTION = SANDBOX_URL + '/mturk/externalSubmit';

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

function getRadios() {
  return document.querySelectorAll('input[type="radio"]');
}

function getCheckedRadios() {
  return document.querySelectorAll('input[type="radio"]:checked');
}

function isFormReady() {
  return getCheckedRadios().length > 0;
}

function validateForm() {
  if (isFormReady()) {
    $('#submit-btn').className = 'active';
    return true;
  }

  $('#submit-btn').className = '';
  return false;
}


function checkForm() {
  if (!validateForm()) {
    setMessage('Must listen and select a value to submit.');
    $('.answers').className = 'answers highlight';
    return false;
  }

  var f = $('form');
  f.submit();
  return true;
}

function onLoad() {
  var query = getQuery();

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
  var s = $('#submit-btn');
  s.addEventListener('click', checkForm);

  var r = getRadios();
  for (var i = 0; i < r.length; i++) {
    r[i].onclick = validateForm;
  }
}

document.addEventListener('DOMContentLoaded', onLoad);
