// ringmon.js
//
// Refers to html stuff at monview.html


// Drag and drop from http://github.com/gaarf/jqDnR-touch
 /*
   * jqDnR-touch - Minimalistic Drag'n'Resize for jQuery.
   * Licensed under the MIT License: http://www.opensource.org/licenses/mit-license.php
   *
   * http://github.com/gaarf/jqDnR-touch
   *
   */

(function($){

  var DOWN = 'mousedown touchstart',
      MOVE = 'mousemove touchmove',
      STOP = 'mouseup touchend',
      E, M = {};

  function xy(v) {
    var y = v.pageY,
        x = v.pageX,
        t = v.originalEvent.targetTouches;
    if(t) {
      x = t[0]['pageX'];
      y = t[0]['pageY'];
    }
    return {x:x,y:y};
  }

  function toTop($e) {
    var z = 1;
    $e.siblings().each(function(){
      z = Math.max(parseInt($(this).css("z-index"),10) || 1,z);
    });
    return $e.css('z-index', z+1);
  }

  function init(e,h,k) {
    return e.each( function() {
      var $box = $(this),
          $handle = (h) ? $(h,this).css('cursor',k) : $box;
      $handle.bind(DOWN, {e:$box,k:k}, onGripStart);
      if(k=='move') {
        $box.bind(DOWN,{},function(){toTop($box).trigger('jqDnRtop')});
      }
    });
  };

  function onGripStart(v) {
    var p = xy(v), f = function(k) { return parseInt(E.css(k))||false; };
    E = toTop(v.data.e);
    M = {
      X:f('left')||0, Y:f('top')||0,
      W:f('width')||E[0].scrollWidth||0, H:f('height')||E[0].scrollHeight||0,
      pX:p.x, pY:p.y, k:v.data.k, o:E.css('opacity')
    };
    E.css({opacity:0.7}).trigger('jqDnRstart');
    $(document).bind(MOVE,onGripDrag).bind(STOP,onGripEnd);
    return false;
  };

  function onGripDrag(v) {
    var p = xy(v);
    if(M.k == 'move') {
      if(!E.css('position').match(/absolute|fixed/)) {
        E.css({position:'relative'});
      }
      E.css({ left:M.X+p.x-M.pX, top:M.Y+p.y-M.pY } );
    }
    else { // resize
      E.css({ width:Math.max(p.x-M.pX+M.W,0), height:Math.max(p.y-M.pY+M.H,0) });
    }
    return false;
  };

  function onGripEnd() {
    $(document).unbind(MOVE,onGripDrag).unbind(STOP,onGripEnd);
    E.css({opacity:M.o}).trigger('jqDnRend');
  };

  $.fn.jqDrag = function(h) { return init(this, h, 'move'); };
  $.fn.jqResize = function(h) { return init(this, h, 'se-resize'); };

})(jQuery);

var fastPoll = 500;
var normPoll = 2000;
var flagPeriodic = false;
var lastAjaxRequestTime = 0;
var nReplPending = false;
var dataDisplay = false;

var replSessionName="One";
var replSessionId = "";
var replPrinter;

var replIn, replOut;
var replHist = [];
var nextHistNdx;
var ndxHist ;

var annMonData = {}; // annotated JSON of monitoring data, adding __hidden: true
                     // into object data will colapse it on display


$(document).ready(function() {
  // executed upon page load

  // button handlers
  $("#getmondata").click(clickGetMonData);
  $("#dojvmgc").click(clickDoJvmGc);
  $("#irq").click(replBreak);
  $("#submit").click(clickReplSubmit);
  $("#sendmsg").click(clickSendMsg);
  $("#invite").click(clickInvite);

  // initial refresh
  clickGetMonData();

  // hide-data checkbox
  $('#hide-data').on('change', function () {
    if ($(this).is(':checked')) {
      dataDisplay = false;
      $("#dataTree").empty();
    }
    else
      dataDisplay = true;
  });

 // periodic checkbox data refresh
  $('#periodic').on('change', function () {
    if ($(this).is(':checked')) {
      flagPeriodic = true;
      periodicGetMonData();
      $("#getmondata").attr("disabled", true);
    } else {
      flagPeriodic = false;
      $("#getmondata").attr("disabled", false);
    }
  });

  initEditor();
  $("#hide-data").prop("checked", true);
  $("#periodic").prop("checked", false); // make sure that periodic is initially uncheked
                                         // if this is not done loading back from browser
                                         // history toggles it on/off
  $('#periodic').trigger('click');  // periodic data update on
  $("#irq").attr("disabled", true); // interrupt button disabled

  $("#nick-confirm").prop("checked", true);
  $("#mynick").attr("readonly",true);
  $('#nick-confirm').on('change', function () {
    if ($(this).is(':checked')) {
      var ok = doChangeNick($("#mynick").val());
      if (!ok)
        $("#mynick").val(myChatNick);
      $("#mynick").attr("readonly",true);
    } else {
      $("#mynick").attr("readonly",false);
      $("#mynick").focus();
    }
  });
  nicksUpdate(chatNicks);
});


function clickReplSubmit() {
  replSubmit(replIn);
}

function trim(stringToTrim) {
  return stringToTrim.replace(/^\s+|\s+$/g,"");
}
function ltrim(stringToTrim) {
  return stringToTrim.replace(/^\s+/,"");
}
function rtrim(stringToTrim) {
  return stringToTrim.replace(/\s+$/,"");
}

var parentUrl = "none";

function validateConfig(obj) {
  if (isObject(obj)) {
    var fPoll = obj["fast-poll"];
    var nPoll = obj["norm-poll"];
    if (nPoll >= 200 && nPoll <= 2000 &&
        fPoll >= 200 && fPoll <= 500  &&
        fPoll <= nPoll)

      normPoll = nPoll;
      fastPoll = fPoll;

      var freshParentUrl = obj["parent-url"];
      if (freshParentUrl != parentUrl) {
        parentUrl = freshParentUrl;
        $('#parentlink').empty();
        if (parentUrl != "") {
          var html = 'Go to the '+
          '<a href="' + parentUrl+'">original application</a>'+
          ' that this page has been injected into.';
          $('#parentlink').append(html);
        }
     }
  }
}

function handleSid(newSid) {
  if (newSid != replSessionId) {
    // do some changeover stuff
    annMonData = {}; // purge old stuff from display
    replSessionId = newSid;
  }
}

var myChatNick = "";
var chatNicks = [];
var sessCount = 0;

function getVal (obj, name) {
   if (name in obj)
     return obj[name];
   else
     return null;
}

function compareStringArrays(a,b) {
  if (a == null && b == null)
    return true;
  if (a == null || b == null)
    return false;

  if (a.length != b.length)
      return false;

  for (var i=0;i<a.length;i++) {
    if (a[i] != b[i])
      return false;
  }
  return true;
}

function nicksUpdate(nicks) {
  $("#nicks").empty();
  if (sessCount < 2) {
    $("#sendmsg").hide();
    $("#sendmsgt").hide();
  } else {
    $("#sendmsg").show();
    $("#sendmsgt").show();
    $("#nicks").append("<option>All people</option>");
    for (var i in nicks) {
      $("#nicks").append("<option>"+nicks[i]+"</option>");
    }
  }
}

function myNickUpdate(nick) {
  $("#mynick").val(nick);
}

function handleSessionInfo (jdata) {
  // this is data for all sessions including ours
  // we can extract it by our session id
  var obj;
  var i=0;
  var newNicks = [];
  var myNewNick;
  for (obj in jdata) {
    var val = jdata[obj];
    if (!isObject (val)) {
      if (obj == "Total")
        sessCount = val;
      continue;
    }

    for (ndx in val) {
      var f = val[ndx];
      if (!isObject (f))
        continue;
      var sid  = getVal(f, "SessId");
      var nick = getVal(f, "ChatNick");
      if (sid == replSessionId)
        myNewNick = nick;
      else
        newNicks[i++] = nick; // do not put our nick into array
    }
  }
  newNicks = newNicks.sort();
  if (!compareStringArrays (newNicks, chatNicks)) {
    chatNicks = newNicks.slice(); // deep copy
    nicksUpdate(chatNicks);
  }
  if (myNewNick != myChatNick) {
    myChatNick = myNewNick;
    myNickUpdate(myChatNick);
  }
}


function replBreak() {
  doAjaxCmd (
  {
    cmd:   "repl-break",
    sname: replSessionName
  });
}

function sendChatMsg(e) {
  if (e != replIn)
    return;
  var b = e.getValue();
  var s = e.getSelection();
  b = rtrim(b);
  s = rtrim(s);
  if (b == "")
    return;     // nothing to do

  if (s == "") { // no selection
    e.setValue("");
    replHist [nextHistNdx++] = b;
    ndxHist = nextHistNdx; // history pointer past freshest item
    if (ndxHist > 1) {
      if (replHist[ndxHist-1] == replHist[ndxHist-2]) {
        // do not polute history with the same buffer values
        ndxHist--;
        nextHistNdx--;
      }
    }
  } else
    b = s;  // send sellection only, no need to flush the current buffer

  var to = "";
  var sel = $("#nicks").val();
  if (sel != "All people")     // midddle space is important !
    to = sel;

  $("#sendmsg").attr("disabled", false);   // disable Send button
  doAjaxCmd (
  {
    cmd:  "send-chat",
    msg:   b,
    to:    to,
    sname: replSessionName
  });
}

function clickSendMsg() {
  sendChatMsg(replIn);
}

function doChangeNick(newNick) {
  newNick=trim(newNick);
  if (newNick == "")
    return false;
  if (newNick == myChatNick)
    return false;
  newNick = newNick.substring(0, 15); /// max 15 characters
  doAjaxCmd (
  {
    cmd:   "set-chat-nick",
    nick:  newNick,
    sname: replSessionName
  });
  return true;
}

function handleChatMsg(m) {
  m = rtrim(m);
  if (m == "")
    return;

  var timeEnd  = m.indexOf(" ");
  var timeStr  = m.substring(0, timeEnd);
  var nBgn     = timeEnd+1;
  var rest     = m.substring(nBgn);
  var msgStart = nBgn+rest.indexOf(": ")+1;
  var nickStr  = m.substring (nBgn, msgStart);
  var msg      = m.substring(msgStart);

  replPrinter.print("ns", timeStr);
  replPrinter.print("bold", " " + nickStr);
  replPrinter.print("code", msg);
  replPrinter.flush();
}

function replSubmit(e) {
  if (e != replIn)
    return;
  var b = e.getValue();
  var s = e.getSelection();
  b = rtrim(b);
  s = rtrim(s);
  if (b == "")
    return;     // nothing to do

  if (s == "") { // no selection
    e.setValue("");
    replHist [nextHistNdx++] = b;
    ndxHist = nextHistNdx; // history pointer past freshest item
    if (ndxHist > 1) {
      if (replHist[ndxHist-1] == replHist[ndxHist-2]) {
        // do not polute history with the same buffer values
        ndxHist--;
        nextHistNdx--;
      }
    }
  } else
    b = s;  // submit sellection only, no need to flush the current buffer

  $("#irq").attr("disabled", false);   // enable interrupt button
  doAjaxCmd (
  {
    cmd:   "do-repl",
    code:  b,
    sname: replSessionName
  });

}

function bufferEnd(e) {
  e.setSelection(
  {
    line:e.lineCount()-1
  }, null,!0);
}

function appendBuffer(e, s) {
  bufferEnd(e);
  e.replaceSelection(s);
  bufferEnd(e);
}

function restoreBuffer(e, b) {
  b = rtrim(b);
  e.setValue(b);
  bufferEnd(e); // restore cursor at the end of last line
}

function histBack(e) {
  if (e != replIn)
    return;
  if (ndxHist > 0) {
    if (ndxHist == nextHistNdx) {
      var b = e.getValue();
      b = rtrim(b);
      if (b != "") {
        // preserve current buffer if not empty
        replHist[nextHistNdx++] = b;
      }
    }
    ndxHist--;
    if (ndxHist < nextHistNdx) {
      var b = replHist[ndxHist];
      restoreBuffer(e,b);
    }
  }
}

function histFwd(e) {
  if (e != replIn)
    return;
  if (ndxHist < nextHistNdx) {
    ndxHist++;
    if (ndxHist < nextHistNdx) {
      var b = replHist[ndxHist];
      restoreBuffer(e,b);
    } else
      e.setValue("");
  }
}

function clearEditor(e) {
  if (e != replIn)
    return;
  ndxHist = nextHistNdx;
  replOut.setValue("");
  replIn.setValue("");
}

function clearHistory(e) {
  if (e != replIn)
    return;
  ndxHist = nextHistNdx = 0;
  //replIn.setValue("");
}

var clojScript =

     "(loop [i 0]"
+ "\n" + '  (println \"i =\"i)'
+ "\n" + "  (Thread/sleep 1000)"
+ "\n" + "  (if (< i 10)"
+ "\n" + "    (recur (inc i))"
+ "\n" + "    i))      ; Press Ctrl-Enter or 'Execute' button to execute."
+ "\n" + "             ; Once started, the execution of this Clojure snippet"
+ "\n" + "             ; can be stopped by 'Interrupt' button.\n"
+ "\n" + "             ; Press Ctrl-Down while having 'nREPL Input' window"
+ "\n" + "             ; in focus to get this snippet out of the way."
+ "\n" + "             ; Press Ctrl-Up to recall it back from the history.";

function initEditor() {
  replOut = CodeMirror.fromTextArea(document.getElementById('ClojOut'),
    {
      matchBrackets: true,
      mode: "text/x-clojure",
      readOnly:true
    });

  replIn = CodeMirror.fromTextArea(document.getElementById('Cloj'),
    {
      lineNumbers: true,
      matchBrackets: true,
      mode: "text/x-clojure"
    });

  replOut.setValue("");
  //replIn.setValue(clojScript);
  replIn.setValue("");

  // initial state of history - clojScript is already in
  // so Ctrl-Down will produce blank screen
  //replHist[0] = clojScript;
  nextHistNdx = 0;
  ndxHist = 0;

  CodeMirror.keyMap.default["Ctrl-Enter"] = replSubmit;
  CodeMirror.keyMap.default["Ctrl-Up"]    = histBack;
  CodeMirror.keyMap.default["Ctrl-Down"]  = histFwd;
  CodeMirror.keyMap.default["Ctrl-Home"]  = clearEditor;
  CodeMirror.keyMap.default["Ctrl-End"]   = clearHistory;

  replPrinter = createReplPrinter(replOut);
}

function clickGetMonData() {
  doAjaxCmd(
    {
      cmd:   "get-mon-data",
      sname: replSessionName
    });
}

function getMsec() {
  return new Date().getTime();
}

function periodicGetMonData() {
  if (nReplPending) {
    nReplPending = false;
    clickGetMonData();
    setTimeout(periodicGetMonData, fastPoll);
    return;
  }

  if (!flagPeriodic)
    return;
  var delta = getMsec() - lastAjaxRequestTime;
  if ( delta > normPoll)
    clickGetMonData();
  setTimeout(periodicGetMonData, normPoll);  // issue periodic request every normPoll msec if enabled
}

function clickDoJvmGc() {
  $("#dojvmgc").attr("disabled", true); // disable button until GC is executed
  doAjaxCmd(
    {
      cmd: "do-jvm-gc"
    });
}

function createReplPrinter (editor) {
  var theMode ="";  // current output mode
  var buf = "";     // text in 'theMode' buffered so far
  var e;            // editor instance

  e = editor;

  this.print = function (mode, text) {
    if (theMode == "")  // only one time init
      theMode = mode;

    if (mode != theMode) {
      flush();
      theMode = mode;
    }
    buf += text;
  }

  this.flush = function () {
    if (buf == "" || theMode == "")
      return;

    var cName = "";
    switch (theMode) {
      case "out":
        buf = rtrim(buf) ;
        break;
      case "err":
        cName = "cm-error";
        buf = trim(buf) ;
        break;
      case "ns":
        buf = trim(buf) ;
        break;
      case "value":
        buf = rtrim(buf) ;
        cName = "cm-repl-val";
        break;
      case "code":
        buf = rtrim(buf);
        break;
      case "bold":
        cName = "cm-strong";
        break;
    }

    bufferEnd(e);
    var from = e.getCursor();
    appendBuffer(e, buf);
    var to = e.getCursor();

    if (cName != "") {
      e.markText(from, to, cName);
    }
    // ommit trailing newline only for ns
    if (theMode != "ns" && theMode != "bold")
      appendBuffer(e,"\n");
    buf = "";
  }
  return this;
}

function searchVec (v, text) {
  for (var i in v) {
    if (v[i] == text)
      return true;
  }
  return false;
}

function respDoRepl(code, jdata) {
  var s = code;
  if (code != "")
    replPrinter.print("code", code);

  for (obj in jdata) {
    var val = jdata[obj];
    if (!isObject (val))
      continue;
    if ("out" in val) {
      var text = val["out"];
      replPrinter.print("out", text);
      s += text;
    }
    if ("ns" in val) {  // ask for ns befotr value
      var text = val["ns"] +"=>";
      s += text;
      replPrinter.print("ns", text);
    }
    if ("value" in val) {
      var text = val["value"];
      s += text;
      replPrinter.print("value", text);
    }
    if ("err" in val) {
      var text = val["err"];
      s += text;
      replPrinter.print("err", text);
    }
    if ("status" in val) {
      var svec = val["status"];
      if (searchVec(svec,"interrupted")) {
        replPrinter.print("err", "Interrupted");
      }
      if (searchVec(svec,"interrupt-id-mismatch")) {
        replPrinter.print("err", "Interrupt operation failed");
      }
    }
    if ("pend" in val) {
      if (val["pend"]) {
        $("#irq").attr("disabled", false);   // enable interrupt button
      } else {
        $("#irq").attr("disabled", true);   // disable interrupt button
      }
      if ("sid" in val)
        handleSid(val["sid"]); // we may want to hadle session chageover
    }
  }
  if (s != "") {
    // there was some repl output activity
    // schedule next request faster
    nReplPending = true;
  }
  replPrinter.flush();
}

function doAjaxCmd(request) {
  // use inner function to be able to refer to original request in closure
  var respCallback = function ( jdata) {
    var cmd = request["cmd"];
    switch (cmd) {
      case "get-mon-data":
        jsonToDataTree(jdata);
        break;
      case "do-jvm-gc":
        $("#dojvmgc").attr("disabled", false); // re-enable button on cmd ack
        clickGetMonData(); // refresh monitoring data
        break;
      case "do-repl":
        respDoRepl(request["code"], jdata);
        break;
      case "repl-break":
        respDoRepl("", jdata);
        break;
      case "chat-send":
        $("#sendmsg").attr("disabled", false);
        clickGetMonData(); // refresh monitoring data
        break;
      case "gen-invite":
        handleInviteResponse(jdata);
        break;
    }
  }

  lastAjaxRequestTime = getMsec();
  $.ajax("/ringmon/command",
    {
      data: request,    // JSON encoded request
      type: "GET",
      dataType: "json",
      contentType: "application/json",
      success: respCallback
    });
}

function isObject ( obj ) {
  return obj && (typeof obj  === "object");
}

function isArray(obj) {
  return (typeString(obj) == "array");
}

function typeString(o) {
  if (typeof o != 'object')
    return typeof o;
  if (o === null)
      return "null";
  //object, array, function, date, regexp, string, number, boolean, error
  var internalClass = Object.prototype.toString.call(o)
                                               .match(/\[object\s(\w+)\]/)[1];
  return internalClass.toLowerCase();
}

function strAlign(s){
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if ((c >="0" && c <= "9") || c == "." || c == "%" || c == " ")
      continue;
    else
      return "left";
  }
  return "right";
}

function getAlignment(v) {
  var t = typeString(v);
  switch (t) {
    case "number":
    case "boolean":
      return "right";
    case "string":
      return strAlign(v);
    default:
      return "left";
  }
}

// search json object jobj for the first instance of
// object named objname and
// then set its property named "__hidden" to val
function annSetHidden(jobj, objname, val) {
  for (var name in jobj) {
    var v = jobj[name];
    if (isObject(v)) {
      if (name == objname) {
        v["__hidden"] = val;
        return;
      } else
        annSetHidden(v, objname,val)
    }
  }
}

function attachHideHandler (id) {
  $("[id="+id+"]").on("change", function(event) {
    var nameCell, name;

    nameCell = event.target.nextSibling;
    name = nameCell.textContent;
    name = name.slice(0, name.length - 1); // remove ":" at the end
    if ($(this).is(':checked'))
      annSetHidden(annMonData, name, false);
    else
      annSetHidden(annMonData, name,  true);
    jsonToDataTree(annMonData);
  });
}

var TreeStyles =
{
  Hdr : {
    light:  ' style="background:#F5F51D;"',
    dark:   ' style="background:#80800E"'},
  Name : {
    light:  ' style="background:#BAF7C3; "',
    dark:   ' style="background:#5DF7C3"'},
  Val : {
    light:  ' style="background:#B5F2F5"',
    dark:   ' style="background:#B5F2F5"'}
};

var tableTag = '<table border=1 cellspacing=0 padding=0 style="margin-left:';

function makeObjectHdr(ident, name, hidden) {
  var s = tableTag + ident*15 +'"><tr>';
  var chkState = "";
  var align = ' align="left"';
  var style = TreeStyles.Hdr.light;

  if (!hidden)
      chkState  = 'checked="yes"';
  var cell = '<input type="checkbox" id="hide"'+chkState+">"+name+"</input>";

  s += "<td"+align+style+">"+cell+":</td></tr></table>"
  return s;
}

function makeObjectVal(name, val) {
  var chkState = "";
  var nalign = ' align="right"';
  var nstyle = TreeStyles.Name.light;
  var vstyle = TreeStyles.Val.light;
  var valign = ' align="'+ getAlignment(val) + '";'

  var s = "<tr><td" + nalign + nstyle + ">" + name + "</td>"
            + "<td" + valign + vstyle + ">" + val  + "</td></tr>";
  return s;
}

function makeTableHdr(element) {
  var s = "";
  var align = ' align="center"';
  var style = TreeStyles.Name.light;
  var vstyle = style;

  for (var name in element)
    s += "<td"+align+style+">" + name + "</td>";
  return s;
}

function makeTableRow(element) {
  var s = "<tr>";
  var vstyle = TreeStyles.Val.light;

  for (var name in element) {
    var val = element[name];
    var valign = ' align="' + getAlignment(val) + '";'
    if (isObject(val))
      val = "Object";     // do this later, just for fun
    s += "<td" + valign + vstyle+">" + val + "</td>";
  }
  s += "</tr>";
  return s;
}

function makeTableVal (v) {
  var vstyle = TreeStyles.Val.light;
  var valign = ' align="' + getAlignment(v) + '";'
  var s = "<td" + valign + vstyle+">" + v + "</td>";
  return s;
}

function makeTable(arr, ident) {
  var prevHdr = "";
  var prevScalar = false;
  var s = tableTag + ident*15 +'"><tr>';

  for (ndx in arr) {
    if (isArray (arr[ndx])) {
      var x = arr[ndx];
      s += makeTableRow(x);
      prevScalar = false;
      prevHdr = "";
      continue;
    }
    if (isObject(arr[ndx])) {
      var hdr = makeTableHdr(arr[ndx]);
      var row = makeTableRow(arr[ndx])
      if (hdr != prevHdr)
        s += hdr;
      s += row;
      prevHdr = hdr;
      prevScalar = false;
    } else {
      if (!prevScalar)
        s += "<tr>";
      s += makeTableVal(arr[ndx]);
      prevScalar = true;
    }
  }
  if (prevScalar)
    s += "</tr>";
  s += "</table>";
  return s;
}

function makeTree(jdata, ident) {
  var prevIsObj = true;
  var s = "";
  for (var name in jdata) {
    if (name == "nREPL") {
      respDoRepl("", jdata[name]);
      continue;         // skip nREPL
    }
    if (name == "_config") {
      var val = jdata[name];
      validateConfig(val);
      continue;         // skip __config
    }
    if (name == "_chatMsg") {
      var val = jdata[name];
      handleChatMsg(val);
      continue;         // skip __chatMsg
    }
    if (name == "_replBuf") {
      var val = jdata[name];
      handleReplBufMsg(val); // remote repl buffer update
      continue;         // skip __replBuf
    }
    if (name == "ReplSessions") {
      var val = jdata[name];
      handleSessionInfo(val); // handle session information, but proceed as normal
    }
    var val = jdata[name];
    if (!isObject(val)) {
      if (prevIsObj)
        s += tableTag + ident*15+'">';
      if (name != "__hidden")  // do not show hidden field, it is only for internal use
        s += makeObjectVal(name, val);
    }  else {
      var hidden = false;
      if ("__hidden" in val)
        hidden = val["__hidden"];
      if (!prevIsObj)
        s += "</table>";
      s += makeObjectHdr(ident, name, hidden);
      if (!hidden) {
        if (isArray (val))
          s +=makeTable(val, ident+1);
        else
          s += makeTree(val, ident+1);
      }
    }
    prevIsObj = isObject(val);
  }
  return s;
}

function isEmpty(obj) {
  for(var i in obj)
    return false;
  return true;
}

function annotateJson(fresh, ann) {
  var init = false;
  var firstobj = false;
  if (isEmpty (ann)) {
    // initial update set all hidden except first one
    init = true;
    firstobj = true;
  }

  for (var name in fresh) {
    if (name == "nREPL") {
      ann[name]= fresh[name];
      continue;
    }
    var val = fresh[name];
    if (isObject (val)) {
      if (!(name in ann) ) {
        ann[name]= fresh[name];
        if (init) {
          if (firstobj) {
            ann[name]["__hidden"] = false;
            firstobj = false;
          } else
            ann[name]["__hidden"] = true;
        }
      } else
        annotateJson(val, ann[name]);
      } else {
      ann[name] = fresh[name]; // fresh data value
    }
  }
}

function jsonToDataTree(jdata) {
  annotateJson(jdata, annMonData); // update annotated data
                                   // preserving hidden field markers, if any

  var s= makeTree(annMonData, 1);
  if (dataDisplay) {
    $("#dataTree").empty();
    $("#dataTree").append(s);
    attachHideHandler("hide");
  }
}

var invite=
"<p>" +
"Please enter the name of the person you want to invite to discuss "+
"the Clojure code snippet/selection that you currently in have in " +
"your REPL input window. The invite URL will be generated in the " +
"REPL output window." + "</p>" +
"The URL will be associated with the invited party name. " +
"Ideally you will want to use their IRC nick. " +
"The invitation URL can be passed on by any Internet communication channel "+
"such as IRC, tweet or an e-mail, IRC being the most convenient. " +
"When the invitee eventually connects to the URL supplied, the system will try to"+
" assign them internal chat nick identical to the name you originally specified "+
"if possible, otherwise a close approximation will be generated by adding "+
"a numerical suffix. " + "</p>" +
"If an invitation is passed via IRC, more than one person may respond. "+
"This is OK, they will all eventually accept their given nicks or change "+
"them to something  more appropriate. When the invited person(s) respond, "+
"they will be presented with the replica of the contents of your input "+
"REPL window at the time the invitation was generated. Then they can review the" +
" code snippet, possibly try to run it and provide the feedback, either "+
"through internal chat facility or through #clojure or some " +
"other IRC channel. " + "</p>" +
"If revised code fragments are to be passed back and forth "+
"it is probably better to use the internal chat." +
"<p>This feature is not ready yet.</p>"+ 
"</p> Invitee's name: " ;

var templateHtml=
    invite            +
  "<input       "     +
  'type="text"'       +
  ' id="invite-nick">'+
  "</input>";


function handleInviteResponse (jdata) {
  var url  = jdata["url"];
  var name = jdata["name"];

  var s = "The invitation URL for " + name +" is: " + url;
  replPrinter.print("code", s);
  replPrinter.flush();
}

function sendInvite(e, name) {
  if (e != replIn)
    return false;
  var b = e.getValue();
  var s = e.getSelection();
  b = rtrim(b);
  s = rtrim(s);

  if (s == "") {
    if (b == "")
      return false;
  }
  else
    b = s;

  // b is not empty, send it
  doAjaxCmd (
  {
    cmd:   "gen-invite",
    msg:   b,
    from:  myChatNick,
    to:    name.substring(0,15),
    sname: replSessionName
  });
  return true;
}

function cback (name) {
  name = trim(name);
  if (name != "") {
    var ok = sendInvite(replIn, name);
    if (!ok)
      replPrinter.print("code",
        "Nothing found to be to sent, no invite generated.");
  }
}

function clickInvite() {
  var name = replOut.openDialog(templateHtml, cback);
}

function handleReplBufMsg(m) { // remote repl input bufer update

 
  m = rtrim(m);                // either invite or initial setup
  if (m == "")
    return;
   console.log("got "+m);
  // m is the new contents of input buffer
  var e = replIn;
  var b = rtrim(e.getValue());
  e.setValue("");
  if (b != m && b != "") {
    // save existing content in history
    replHist [nextHistNdx++] = b;
    ndxHist = nextHistNdx; // history pointer past freshest item
    if (ndxHist > 1) {
      if (replHist[ndxHist-1] == replHist[ndxHist-2]) {
        // do not polute history with the same buffer values
        ndxHist--;
        nextHistNdx--;
      }
    }
    replPrinter.print("code",
      "WARNING: Your current buffer has been moved to history, "+
      "to make room for the incomming message,\npossibly an invite "+
      "or the result "+
      "of the server app restart. Recall the buffer back with Ctrl-Up.");
    replPrinter.flush();
    console.log ("WARN");
  }
  appendBuffer(e,m);
  replHist [nextHistNdx++] = m;
  ndxHist = nextHistNdx; // history pointer past freshest item
  if (ndxHist > 1) {
    if (replHist[ndxHist-1] == replHist[ndxHist-2]) {
      // do not polute history with the same buffer values
      ndxHist--;
      nextHistNdx--;
    }
  }
}

