var App = (function () {
  'use strict';

  var _data = null;
  var _currentTab = 'teachers';
  var _isSaving = false;
  var _pendingChanges = [];

  function _sanitizeName(name) {
    return name.trim().replace(/[^\u4e00-\u9fff·・]/g, '');
  }

  function _now() {
    return Date.now();
  }

  var RATE_LIMIT_KEY_GENERAL = 'rl_global';
  var RATE_LIMIT_MS = 60000;

  function _getRateLimitKey(category, personName) {
    return 'rl_' + category + '_' + encodeURIComponent(personName);
  }

  function checkRateLimit(category, personName) {
    var now = _now();

    var globalLast = parseInt(localStorage.getItem(RATE_LIMIT_KEY_GENERAL) || '0', 10);
    if (now - globalLast < RATE_LIMIT_MS) {
      var remain = Math.ceil((RATE_LIMIT_MS - (now - globalLast)) / 1000);
      return {
        allowed: false,
        remainingMs: RATE_LIMIT_MS - (now - globalLast),
        message: 'IP 冷却中，请等待 ' + remain + ' 秒后再试'
      };
    }

    if (personName) {
      var personKey = _getRateLimitKey(category, personName);
      var personLast = parseInt(localStorage.getItem(personKey) || '0', 10);
      if (now - personLast < RATE_LIMIT_MS) {
        var remain2 = Math.ceil((RATE_LIMIT_MS - (now - personLast)) / 1000);
        return {
          allowed: false,
          remainingMs: RATE_LIMIT_MS - (now - personLast),
          message: '当前角色投票时间冷却中，请等待 ' + remain2 + ' 秒后再试'
        };
      }
    }

    return { allowed: true, remainingMs: 0, message: '' };
  }

  function setRateLimit(category, personName) {
    var now = _now();
    localStorage.setItem(RATE_LIMIT_KEY_GENERAL, String(now));
    if (personName) {
      var personKey = _getRateLimitKey(category, personName);
      localStorage.setItem(personKey, String(now));
    }
  }

  function loadData() {
    return new Promise(function (resolve, reject) {
      var token = window.CONFIG.getToken();
      if (token) {
        _loadFromAPI().then(resolve).catch(reject);
      } else {
        var url = window.CONFIG.getRawUrl();
        fetch(url, { cache: 'no-cache' })
          .then(function (res) {
            if (!res.ok) throw new Error('数据加载失败 (HTTP ' + res.status + ')');
            return res.text();
          })
          .then(function (text) {
            try {
              var d = JSON.parse(text);
              _initData(d);
              resolve(_data);
            } catch (e) {
              reject(new Error('数据解析失败: ' + e.message));
            }
          })
          .catch(reject);
      }
    });
  }

  function _initData(d) {
    _data = d;
    if (!_data.teachers) _data.teachers = { order: [], items: {} };
    if (!_data.students) _data.students = { order: [], items: {} };
    if (!_data.hangla) _data.hangla = { order: [], items: {} };
    if (!_data.teachers.order) _data.teachers.order = [];
    if (!_data.teachers.items) _data.teachers.items = {};
    if (!_data.students.order) _data.students.order = [];
    if (!_data.students.items) _data.students.items = {};
    if (!_data.hangla.order) _data.hangla.order = [];
    if (!_data.hangla.items) _data.hangla.items = {};
  }

  function _loadFromAPI() {
    return new Promise(function (resolve, reject) {
      var token = window.CONFIG.getToken();
      if (!token) return reject(new Error('未配置 Token'));

      fetch(window.CONFIG.getApiUrl(), {
        cache: 'no-cache',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('API 读取失败 (HTTP ' + res.status + ')');
          return res.json();
        })
        .then(function (json) {
          var raw = json.content.replace(/\n/g, '');
          var bytes = atob(raw);
          var content = decodeURIComponent(escape(bytes));
          _data = JSON.parse(content);
          resolve(_data);
        })
        .catch(reject);
    });
  }

  function refreshData() {
    return _loadFromAPI().then(function () {
      renderTab(_currentTab);
    });
  }

  function saveData() {
    return new Promise(function (resolve, reject) {
      if (_isSaving) {
        _pendingChanges.push({ resolve: resolve, reject: reject });
        return;
      }
      _isSaving = true;

      var token = window.CONFIG.getToken();
      if (!token) {
        _isSaving = false;
        return reject(new Error('未配置 GitHub Token，无法保存数据'));
      }

      var contentStr = JSON.stringify(_data, null, 2);
      var contentBase64 = btoa(unescape(encodeURIComponent(contentStr)));

      _doSave(contentBase64, token, 3).then(function () {
        _isSaving = false;
        resolve();
        if (_pendingChanges.length > 0) {
          var next = _pendingChanges.shift();
          saveData().then(next.resolve).catch(next.reject);
        }
      }).catch(function (err) {
        _isSaving = false;
        reject(err);
      });
    });
  }

  function _doSave(contentBase64, token, retries) {
    return fetch(window.CONFIG.getApiUrl(), {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('获取文件 SHA 失败 (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(function (fileInfo) {
        return fetch(window.CONFIG.getApiUrl(), {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'update',
            content: contentBase64,
            sha: fileInfo.sha,
            branch: window.CONFIG.branch
          })
        });
      })
      .then(function (res) {
        if (res.status === 409 && retries > 0) {
          return _doSave(contentBase64, token, retries - 1);
        }
        if (!res.ok) throw new Error('数据保存失败 (HTTP ' + res.status + ')');
        return res.json();
      });
  }

  function _ensurePerson(category, name) {
    var cat = _data[category];
    if (!cat.items[name]) {
      if (category === 'hangla') {
        cat.items[name] = { hang: 0, la: 0, comments: [] };
      } else {
        cat.items[name] = { votes: 0, comments: [] };
      }
      if (cat.order.indexOf(name) === -1) {
        cat.order.push(name);
      }
    }
  }

  function addPerson(category, name) {
    name = _sanitizeName(name);
    if (!name) return { ok: false, msg: '请输入有效的人名' };

    var cat = _data[category];
    if (cat.items[name]) {
      return { ok: false, msg: '该人物已存在' };
    }

    _ensurePerson(category, name);

    saveData().catch(function (err) {
      _showToast('保存失败: ' + err.message);
    });

    return { ok: true, msg: '添加成功' };
  }

  function vote(category, name, type) {
    var cat = _data[category];
    if (!cat || !cat.items[name]) {
      return { ok: false, msg: '该人物不存在' };
    }

    var limit = checkRateLimit(category, name);
    if (!limit.allowed) {
      return { ok: false, msg: limit.message };
    }

    if (category === 'hangla') {
      if (type === 'hang') {
        cat.items[name].hang = (cat.items[name].hang || 0) + 1;
      } else if (type === 'la') {
        cat.items[name].la = (cat.items[name].la || 0) + 1;
      } else {
        return { ok: false, msg: '无效的投票类型' };
      }
    } else {
      cat.items[name].votes = (cat.items[name].votes || 0) + 1;
    }

    setRateLimit(category, name);

    saveData().catch(function (err) {
      _showToast('保存失败: ' + err.message);
    });

    return { ok: true, msg: '投票成功' };
  }

  function addComment(category, name, text) {
    text = text.trim();
    if (!text) return { ok: false, msg: '评论不能为空' };

    var cat = _data[category];
    if (!cat || !cat.items[name]) {
      return { ok: false, msg: '该人物不存在' };
    }

    if (!cat.items[name].comments) {
      cat.items[name].comments = [];
    }

    cat.items[name].comments.push({
      text: text,
      time: _now()
    });

    saveData().catch(function (err) {
      _showToast('保存失败: ' + err.message);
    });

    return { ok: true, msg: '评论成功' };
  }

  function getSortedList(category) {
    var cat = _data[category];
    if (!cat) return [];

    var list = cat.order.map(function (name) {
      var item = cat.items[name];
      if (category === 'hangla') {
        return {
          name: name,
          hang: item.hang || 0,
          la: item.la || 0,
          score: (item.hang || 0) - (item.la || 0),
          total: (item.hang || 0) + (item.la || 0)
        };
      } else {
        return {
          name: name,
          votes: item.votes || 0,
          commentCount: (item.comments || []).length
        };
      }
    });

    if (category === 'hangla') {
      list.sort(function (a, b) { return b.score - a.score; });
    } else {
      list.sort(function (a, b) { return b.votes - a.votes; });
    }

    return list;
  }

  function getPersonDetail(category, name) {
    var cat = _data[category];
    if (!cat || !cat.items[name]) return null;

    var item = cat.items[name];
    return {
      name: name,
      detail: item,
      category: category
    };
  }

  function renderTab(tab) {
    _currentTab = tab;
    var tabBtns = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    panels.forEach(function (panel) {
      panel.classList.toggle('active', panel.dataset.tab === tab);
    });

    if (tab === 'teachers') renderTeachers();
    else if (tab === 'students') renderStudents();
    else if (tab === 'hangla') renderHangLa();
  }

  function renderTeachers() {
    var list = getSortedList('teachers');
    var container = document.getElementById('teachers-list');
    container.innerHTML = '';

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-msg">【空无一人】</div>';
      return;
    }

    list.forEach(function (item, idx) {
      var el = _createRankItem('teachers', item, idx);
      container.appendChild(el);
    });
  }

  function renderStudents() {
    var list = getSortedList('students');
    var container = document.getElementById('students-list');
    container.innerHTML = '';

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-msg">【空无一人】</div>';
      return;
    }

    list.forEach(function (item, idx) {
      var el = _createRankItem('students', item, idx);
      container.appendChild(el);
    });
  }

  function renderHangLa() {
    var list = getSortedList('hangla');
    var container = document.getElementById('hangla-list');
    container.innerHTML = '';

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-msg">【空无一人】</div>';
      return;
    }

    list.forEach(function (item, idx) {
      var el = _createHangLaItem(item, idx);
      container.appendChild(el);
    });
  }

  function _createRankItem(category, item, idx) {
    var div = document.createElement('div');
    div.className = 'rank-item';

    var medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '#' + (idx + 1);

    div.innerHTML =
      '<div class="rank-num">' + medal + '</div>' +
      '<div class="rank-name" data-category="' + category + '" data-name="' + item.name + '">' +
        _escapeHtml(item.name) +
      '</div>' +
      '<div class="rank-votes">' + item.votes + ' 票</div>' +
      '<button class="btn-vote" data-category="' + category + '" data-name="' + item.name + '" data-type="up">+1</button>' +
      '<span class="comment-badge">💬 ' + item.commentCount + '</span>';

    return div;
  }

  function _createHangLaItem(item, idx) {
    var div = document.createElement('div');
    div.className = 'rank-item hangla-item';

    var medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '#' + (idx + 1);

    var total = item.hang + item.la;
    var pct = total > 0 ? (item.hang / total) : 0.5;
    var tag = '';
    if (total === 0) tag = '<span class="tag tag-mid">NPC</span>';
    else if (pct >= 0.85) tag = '<span class="tag tag-hang">夯天花板</span>';
    else if (pct >= 0.65) tag = '<span class="tag tag-hang">人上人</span>';
    else if (pct >= 0.40) tag = '<span class="tag tag-mid">NPC</span>';
    else if (pct >= 0.20) tag = '<span class="tag tag-mid">拉完了</span>';
    else tag = '<span class="tag tag-la">💩 拉穿地心</span>';

    var hangPct = total > 0 ? (item.hang / total * 100) : 50;

    div.innerHTML =
      '<div class="rank-num">' + medal + '</div>' +
      '<div class="rank-name" data-category="hangla" data-name="' + item.name + '">' +
        _escapeHtml(item.name) + ' ' + tag +
      '</div>' +
      '<div class="rank-bar-wrap">' +
        '<div class="rank-bar">' +
          '<div class="bar-hang" style="width:' + hangPct + '%">夯' + item.hang + '</div>' +
          '<div class="bar-la" style="width:' + (100 - hangPct) + '%">拉' + item.la + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rank-votes">' +
        '<span class="hang-count">夯 ' + item.hang + '</span>' +
        '<span class="la-count">拉 ' + item.la + '</span>' +
      '</div>' +
      '<div class="hangla-btns">' +
        '<button class="btn-hang" data-category="hangla" data-name="' + item.name + '" data-type="hang">+夯</button>' +
        '<button class="btn-la" data-category="hangla" data-name="' + item.name + '" data-type="la">+拉</button>' +
      '</div>';

    return div;
  }

  function _escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showDetail(category, name) {
    var data = getPersonDetail(category, name);
    if (!data) return;

    var overlay = document.getElementById('modal-overlay');
    var body = document.getElementById('modal-body');
    var title = document.getElementById('modal-title');

    title.textContent = data.name;

    var html = '<div class="modal-detail">';

    if (category === 'hangla') {
      var item = data.detail;
      var total = (item.hang || 0) + (item.la || 0);
      html +=
        '<div class="dlg-stats">' +
          '<div class="dlg-hang">🔺 夯: ' + (item.hang || 0) + '</div>' +
          '<div class="dlg-la">🔻 拉: ' + (item.la || 0) + '</div>' +
          '<div class="dlg-total">总分: ' + ((item.hang || 0) - (item.la || 0)) + '</div>' +
          '<div class="dlg-total">总票数: ' + total + '</div>' +
        '</div>' +
        '<div class="dlg-actions">' +
          '<button class="btn-hang dlg-vote" data-category="hangla" data-name="' + name + '" data-type="hang">+ 夯</button>' +
          '<button class="btn-la dlg-vote" data-category="hangla" data-name="' + name + '" data-type="la">+ 拉</button>' +
        '</div>';
    } else {
      html +=
        '<div class="dlg-stats">' +
          '<div class="dlg-votes">🗳️ ' + (data.detail.votes || 0) + ' 票</div>' +
        '</div>' +
        '<div class="dlg-actions">' +
          '<button class="btn-vote dlg-vote" data-category="' + category + '" data-name="' + name + '" data-type="up">+1 投票</button>' +
        '</div>';
    }

    html += '<div class="dlg-comments"><h4>💬 评论</h4><div class="comment-list">';
    var comments = data.detail.comments || [];
    if (comments.length === 0) {
      html += '<div class="empty-msg">暂无评论</div>';
    } else {
      for (var i = comments.length - 1; i >= 0; i--) {
        var c = comments[i];
        html += '<div class="comment-item">' +
          '<span class="comment-text">' + _escapeHtml(c.text) + '</span>' +
          '<span class="comment-time">' + _formatTime(c.time) + '</span>' +
        '</div>';
      }
    }
    html += '</div>';

    html +=
      '<div class="comment-input-wrap">' +
        '<input type="text" id="comment-input" placeholder="留下你的锐评..." maxlength="200" />' +
        '<button id="comment-submit" data-category="' + category + '" data-name="' + name + '">发送</button>' +
      '</div>';

    html += '</div></div>';

    body.innerHTML = html;
    overlay.classList.add('active');
    document.body.classList.add('modal-open');

    _bindModalEvents(category, name);
  }

  function _bindModalEvents(category, name) {
    var submitBtn = document.getElementById('comment-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var input = document.getElementById('comment-input');
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;

        var result = addComment(category, name, text);
        if (result.ok) {
          input.value = '';
          showDetail(category, name);
          renderTab(_currentTab);
          _showToast('评论成功');
        } else {
          _showToast(result.msg);
        }
      });
    }

    var voteBtns = body.querySelectorAll('.dlg-vote');
    voteBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.dataset.category;
        var nm = btn.dataset.name;
        var typ = btn.dataset.type;
        var result = vote(cat, nm, typ);
        if (result.ok) {
          showDetail(cat, nm);
          renderTab(_currentTab);
          _showToast('投票成功');
        } else {
          _showToast(result.msg);
        }
      });
    });
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    document.body.classList.remove('modal-open');
  }

  function _showToast(msg) {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('show');
    }, 10);

    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 2500);
  }

  function _formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function _showSetupDialog() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="setup-dialog">' +
        '<div class="setup-box">' +
          '<h2>⬡ 首次设置</h2>' +
          '<p class="setup-desc">输入你的 GitHub Fine-grained Token 以启用数据写入</p>' +
          '<div class="setup-info">' +
            '<p><strong>仓库</strong> ' + _escapeHtml(window.CONFIG.owner) + '/' + _escapeHtml(window.CONFIG.repo) + '</p>' +
            '<p><strong>权限要求</strong> Contents → Read and write</p>' +
          '</div>' +
          '<div class="setup-field">' +
            '<label>Fine-grained Token</label>' +
            '<input type="password" id="setup-token-input" placeholder="粘贴你的 github_pat_xxx..." />' +
          '</div>' +
          '<div class="setup-actions">' +
            '<button id="setup-save-btn">保存并加载</button>' +
          '</div>' +
          '<p class="setup-hint">Token 会混淆后存在浏览器本地，不会上传到任何地方。' +
          '换设备需要重新输入。</p>' +
          '<p class="setup-hint">忘记 Token 了？去 GitHub Settings → Developer settings → ' +
          'Personal access tokens → Fine-grained tokens 查看或重新生成。</p>' +
        '</div>' +
      '</div>';

    document.getElementById('setup-token-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _handleSetupSave();
    });
    document.getElementById('setup-save-btn').addEventListener('click', _handleSetupSave);
  }

  function _handleSetupSave() {
    var input = document.getElementById('setup-token-input');
    var token = input.value.trim();
    if (!token) {
      _showToast('请输入 Token');
      return;
    }

    var btn = document.getElementById('setup-save-btn');
    btn.disabled = true;
    btn.textContent = '验证中...';

    var testUrl = 'https://api.github.com/repos/' + window.CONFIG.owner + '/' + window.CONFIG.repo + '/contents/' + window.CONFIG.dataPath;
    fetch(testUrl, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
      .then(function (res) {
        if (res.status === 200 || res.status === 404) {
          window.CONFIG.setToken(token);
          _showToast('Token 验证通过！');
          setTimeout(function () { location.reload(); }, 800);
        } else if (res.status === 401 || res.status === 403) {
          throw new Error('Token 无效或权限不足 (HTTP ' + res.status + ')');
        } else {
          throw new Error('验证失败 (HTTP ' + res.status + ')');
        }
      })
      .catch(function (err) {
        _showToast(err.message);
        btn.disabled = false;
        btn.textContent = '保存并加载';
      });
  }

  function init() {
    if (!window.CONFIG.isReady()) {
      _showSetupDialog();
      return;
    }

    _showToast('加载数据中...');

    loadData().then(function () {
      var tabBtns = document.querySelectorAll('.tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          renderTab(btn.dataset.tab);
        });
      });

      document.getElementById('btn-add-teacher').addEventListener('click', function () {
        _handleAdd('teachers', 'input-teacher');
      });
      document.getElementById('btn-add-student').addEventListener('click', function () {
        _handleAdd('students', 'input-student');
      });
      document.getElementById('btn-add-hangla').addEventListener('click', function () {
        _handleAdd('hangla', 'input-hangla');
      });

      document.getElementById('input-teacher').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') _handleAdd('teachers', 'input-teacher');
      });
      document.getElementById('input-student').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') _handleAdd('students', 'input-student');
      });
      document.getElementById('input-hangla').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') _handleAdd('hangla', 'input-hangla');
      });

      document.getElementById('app').addEventListener('click', function (e) {
        var target = e.target;

        if (target.classList.contains('btn-vote') || target.classList.contains('btn-hang') || target.classList.contains('btn-la')) {
          var cat = target.dataset.category;
          var nm = target.dataset.name;
          var typ = target.dataset.type || 'up';
          var result = vote(cat, nm, typ);
          if (result.ok) {
            renderTab(_currentTab);
            _showToast('投票成功');
          } else {
            _showToast(result.msg);
          }
          return;
        }

        if (target.classList.contains('rank-name')) {
          var cat2 = target.dataset.category;
          var nm2 = target.dataset.name;
          showDetail(cat2, nm2);
          return;
        }
      });

      document.getElementById('modal-overlay').addEventListener('click', function (e) {
        if (e.target === this) closeModal();
      });
      document.getElementById('modal-close').addEventListener('click', closeModal);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
      });

      renderTab('teachers');
      _showToast('加载完成');

      var disclaimer = document.getElementById('disclaimer');
      var appEl = document.getElementById('app');
      var loading = document.getElementById('disclaimer-loading');
      if (disclaimer) {
        setTimeout(function () {
          if (loading) loading.innerHTML = '<span>加载完成</span>';
          setTimeout(function () {
            disclaimer.style.transition = 'opacity 0.4s';
            disclaimer.style.opacity = '0';
            setTimeout(function () {
              disclaimer.style.display = 'none';
              if (appEl) appEl.style.display = '';
            }, 400);
          }, 100);
        }, 500);
      } else {
        if (appEl) appEl.style.display = '';
      }
    }).catch(function (err) {
      document.getElementById('app').innerHTML =
        '<div class="setup-warning">' +
          '<h2>❌ 数据加载失败</h2>' +
          '<p>' + _escapeHtml(err.message) + '</p>' +
          '<hr/>' +
          '<p>请确认：</p>' +
          '<p>1. 库名是否正确</p>' +
          '<p>2. 已有数据文件</p>' +
          '<p>3. 权限是否为Read and write</p>' +
          '<p>4. 请确保配置正确</p>' +
          '<button onclick="location.reload()" style="margin-top:16px;padding:8px 24px;cursor:pointer;">重新加载</button>' +
        '</div>';
    });
  }

  function _handleAdd(category, inputId) {
    var input = document.getElementById(inputId);
    var rawName = input.value.trim();
    if (!rawName) {
      _showToast('请输入人名');
      return;
    }

    var name = _sanitizeName(rawName);
    if (!name) {
      _showToast('仅支持中文人名');
      return;
    }

    var now = Date.now();
    var lastAdd = parseInt(localStorage.getItem('rl_add_global') || '0', 10);
    if (now - lastAdd < 2000) {
      var sec = Math.ceil((2000 - (now - lastAdd)) / 1000);
      _showToast('操作过快，请等 ' + sec + ' 秒后再试');
      return;
    }

    var hourlyCount = 0;
    var hourlyRaw = localStorage.getItem('rl_add_hourly');
    var hourlyArr = hourlyRaw ? JSON.parse(hourlyRaw) : [];
    hourlyArr = hourlyArr.filter(function (t) { return now - t < 3600000; });
    if (hourlyArr.length >= 40) {
      _showToast('已达每小时添加上限（40个），请稍后再试');
      return;
    }
    hourlyArr.push(now);
    localStorage.setItem('rl_add_hourly', JSON.stringify(hourlyArr));

    localStorage.setItem('rl_add_global', String(now));

    var btnId = 'btn-add-' + category;
    var btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;

    var result = addPerson(category, name);
    if (result.ok) {
      input.value = '';
      renderTab(category);
      _showToast('已添加：' + name);
    } else {
      _showToast(result.msg);
    }

    if (btn) setTimeout(function () { btn.disabled = false; }, 1000);
  }

  return {
    init: init,
    renderTab: renderTab,
    showDetail: showDetail,
    closeModal: closeModal,
    addPerson: addPerson,
    vote: vote,
    addComment: addComment,
    loadData: loadData
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  App.init();
});
