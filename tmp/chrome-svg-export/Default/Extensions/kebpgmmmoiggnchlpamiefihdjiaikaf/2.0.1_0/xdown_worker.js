
self.importScripts('cookie_manager.js');
self.importScripts('native_host_manager.js');
self.importScripts('xdown_extension.js');
self.importScripts('xdown_context.js');

var xdownExt = new XDownExtension;
xdownExt.initialize();

function checkIsDownloadFile(d) {
  var file = true;
  let mime = d.mime || '';
  if (mime) {
      var cType = mime.toLowerCase();
      if (cType.indexOf("json") != -1 || cType.indexOf("image/") != -1 ||
         (cType.indexOf("text") != -1 && cType.indexOf("text/x-sql") == -1) ||
          cType.indexOf("javascript") != -1 ||
          cType.indexOf("application/x-protobuf") != -1 ||
          cType.indexOf("application/binary") != -1 ||
          cType.indexOf("application/pdf") != -1 ||
          cType.indexOf("application/x-bittorrent") != -1) {
          file = false;
      }
      else if (cType.indexOf("application") != -1) {
          file = true;
      }
  }

  if (d.fileSize >= 0) {
      // int64 too long 
      var iLength = parseInt(d.fileSize);
      if (iLength < 2 * 1024 * 1024) {
          file = false;
      }
  }
  return file;
}

const usedXDown = d => new Promise((resolve, reject) => {
  let downList = [];
  if(!checkIsDownloadFile(d)) {
    return resolve({id: d.id, result: 0});
  }
  let url = d.finalUrl || d.url;
  var cManager = new CookieManager;
  cManager.getCookiesForUrl(
      url,
      function (cookies) {
        let cur_length = d.totalBytes || 0;
        let file_name = d.filename || '';
        if(typeof(file_name) != 'undefined' && file_name.length < 1) {
          var curUrl = url;
          var iPosVal = curUrl.indexOf("?");
          if(iPosVal > 1) {
              curUrl = curUrl.substring(0,iPosVal);
          }
          iPosVal = curUrl.indexOf("#");
          if(iPosVal > 1) {
              curUrl = curUrl.substring(0,iPosVal);
          }
          iPosVal = curUrl.lastIndexOf('/');
          if(iPosVal > 10) {
              file_name = curUrl.substring(iPosVal + 1);
          }
        }
        var downItem = {
          'httpReferer': d.referrer,
          'url': url,
          'originalUrl': url,
          'userAgent': navigator.userAgent,
          'httpCookies': cookies || '',
          'httpContentType': d.mime || '',
          'httpContentLength': cur_length.toString(),
          'httpFileName': file_name || '',
        };
        downList.push(downItem);
        let cur_id = d.id || 1;
        let downTask = {
          'id': cur_id.toString(),
          'type': 'create_downloads',
          'create_downloads': {
            'downloads':downList,
          }
        }
        setTimeout(resolve, 10000);
        xdownExt.postMessage(downTask, res => {
          if (!res) {
            return reject(Error('empty response'));
          }
          resolve(res);
        });
      }
  );
});


const transfer = async d => {
  try {
    await usedXDown(d);
    if (d.id) {
      chrome.downloads.erase({
        id: d.id
      });
    }
  }
  catch (e) {
    console.log('error:',e);
  }
};

const onDeterminingFilename = (item, suggest) => {
  usedXDown(item).then(res => {
    let is_intercept = false;
    if(res && res.id) {
      if( typeof(res.result) != 'undefined' && res.result === 1) {
        is_intercept = true;
      }
    }
    if(is_intercept) {
      try{
        chrome.downloads.cancel(item.id), function(){
          console.log('cancel:',item.id);
        }
      } 
      catch (e) {
        console.log('error:',e);
      }
    } else {
      suggest({filename: item.filename, conflictAction: 'uniquify'});
    }
  },err =>{
    suggest({filename: item.filename, conflictAction: 'uniquify'});
  });
  return true;
}

chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);


chrome.runtime.onMessage.addListener((request, sender, response) => {
  if(request && request.type) {
      if(request.type === 'SHOW-XDOWN-SETTING') {
      var settingMsg = {
        'id': "1",
        'type': 'show_settings'
      };
      xdownExt.postMessage(settingMsg, res => {
        if(!res) {
          console.log('[error] start xdown failed....');
          return;
        }
        response(res);
      });
    }
    else if(request.type == 'ADD-XDOWN-EVENT') {
      xdownExt.postMessage(request, res => {
        console.log('ADD-XDOWN-EVENT: ', res);
        response(res);
      });
    }
    return true;
  }
  return false;
});


