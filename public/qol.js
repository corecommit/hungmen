/* QOL layer - loaded after script.js. Only touches the DOM; no game logic. */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const store = {
        get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
        set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
    };

    // 1. Remember the last username (never admin) and focus the field on desktop.
    const nameInput = $('usernameInput');
    if (nameInput) {
        const saved = store.get('hangman:lastUser');
        if (saved && !nameInput.value) nameInput.value = saved;
        if (matchMedia('(pointer: fine)').matches) nameInput.focus();
        $('usernameForm')?.addEventListener('submit', () => {
            const v = nameInput.value.trim();
            if (v && !/admin/i.test(v)) store.set('hangman:lastUser', v);
        }, true);
    }

    // 2. Ask before leaving a running game by accident.
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('#leaveGameBtn') &&
            !confirm('Leave this game? Your progress in this round will be lost.')) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);

    // 3. Esc closes dialogs that have a cancel/close button.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const id of ['cancelCreateRoom', 'cancelJoinRoom', 'cancelAskQuestion', 'closeSettings']) {
            const btn = $(id);
            if (btn && btn.offsetParent !== null) { btn.click(); break; }
        }
    });

    // 4. "N guesses left" counter under the wrong letters.
    const wrong = $('wrongLetters');
    if (wrong && wrong.parentNode) {
        const counter = document.createElement('div');
        counter.className = 'guesses-left';
        counter.style.display = 'none';
        wrong.parentNode.insertBefore(counter, wrong.nextSibling);
        new MutationObserver(() => {
            const left = Math.max(0, 6 - wrong.querySelectorAll('.wrong-letter').length);
            counter.textContent = left === 1 ? '1 guess left' : left + ' guesses left';
            counter.classList.toggle('danger', left <= 2);
            counter.style.display = '';
        }).observe(wrong, { childList: true });
    }

    // 5. Haptics + shake when a key turns correct / wrong.
    const kb = $('keyboard');
    if (kb) {
        const seen = new WeakSet();
        new MutationObserver((list) => {
            for (const m of list) {
                const el = m.target;
                if (!(el instanceof Element) || !el.classList.contains('key') || seen.has(el)) continue;
                if (el.classList.contains('wrong')) {
                    seen.add(el);
                    navigator.vibrate && navigator.vibrate([30, 40, 30]);
                    const box = document.querySelector('.hangman-container');
                    if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
                } else if (el.classList.contains('correct')) {
                    seen.add(el);
                    navigator.vibrate && navigator.vibrate(15);
                }
            }
        }).observe(kb, { attributes: true, attributeFilter: ['class'], subtree: true });
    }

    // 6. Highlight "your turn" and flag it in the tab title when the tab is hidden.
    const turn = $('turnIndicator');
    const baseTitle = document.title;
    if (turn) {
        const check = () => {
            const mine = /your turn/i.test(turn.textContent || '');
            turn.classList.toggle('my-turn', mine);
            document.title = (mine && document.hidden) ? '\u25CF Your turn - ' + baseTitle : baseTitle;
        };
        new MutationObserver(check).observe(turn, { childList: true, characterData: true, subtree: true });
        document.addEventListener('visibilitychange', check);
    }

    // 7. Offline pill.
    const pill = document.createElement('div');
    pill.className = 'offline-pill';
    pill.textContent = 'You are offline. Reconnecting...';
    pill.setAttribute('role', 'status');
    document.body.appendChild(pill);
    const syncPill = () => pill.classList.toggle('show', !navigator.onLine);
    addEventListener('online', syncPill);
    addEventListener('offline', syncPill);
    syncPill();

    // 8. Keep the screen awake during a game (mobile).
    const gv = $('gameView');
    let lock = null;
    const wake = async () => {
        try {
            const active = gv && gv.classList.contains('active');
            if (active && !lock && 'wakeLock' in navigator && !document.hidden) {
                lock = await navigator.wakeLock.request('screen');
                lock.addEventListener('release', () => { lock = null; });
            } else if (!active && lock) { await lock.release(); lock = null; }
        } catch (_) { lock = null; }
    };
    if (gv) {
        new MutationObserver(wake).observe(gv, { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('visibilitychange', wake);
    }
})();
