(function () {
  var REPO_CONFIG = {
    owner: 'SuperDickKing',
    repo: 'ranking',
    branch: 'main',
    dataPath: 'data/data.json'
  };

  var _XOR_KEY = 'rank';
  var _encryptedToken = 'FQgaAwcDMRsTFTFaQyImOSg1LypCOQwoBC88ABkrLFs6PgU6GDIeXjVZIwwGCFYdHxsbCD0CHBI6AiZaRg5eDxNXCw0lJgUHSgU4Mx4vLS4rMz0zNREqGhBTXiU1';

  function _decodeToken(enc, key) {
    var binary = atob(enc);
    var result = '';
    for (var i = 0; i < binary.length; i++) {
      result += String.fromCharCode(
        binary.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return result;
  }

  window.CONFIG = {
    owner: REPO_CONFIG.owner,
    repo: REPO_CONFIG.repo,
    branch: REPO_CONFIG.branch,
    dataPath: REPO_CONFIG.dataPath,

    getToken: function () {
      try {
        return _decodeToken(_encryptedToken, _XOR_KEY);
      } catch (e) {
        console.error('[Config] Token 解密失败:', e);
        return null;
      }
    },

    isReady: function () {
      return true;
    },

    getRawUrl: function () {
      return 'https://raw.githubusercontent.com/'
        + this.owner + '/' + this.repo + '/'
        + this.branch + '/' + this.dataPath
        + '?t=' + Date.now();
    },

    getApiUrl: function () {
      return 'https://api.github.com/repos/'
        + this.owner + '/' + this.repo + '/contents/'
        + this.dataPath;
    }
  };
})();
