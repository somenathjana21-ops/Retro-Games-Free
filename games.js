/* ============================================================
   NEON ARCADE — games.js
   Shared utility library for all game pages.

   HOW TO USE IN A GAME PAGE:
     <script src="../games.js"></script>
     Then call any function directly, e.g. updateScore(el, 100)

   HOW TO EXTEND:
     - Add new sound names to SOUND_MAP (see playSound section).
     - Add new toast variants by passing { variant } options.
     - Add new storage helpers following the saveHighScore pattern.
     - Register new parallax scenes via initParallax(config).
   ============================================================ */

'use strict';

/* ╔══════════════════════════════════════════════════════════════╗
   ║  1. ENVIRONMENT / GLOBAL CONFIG                             ║
   ║                                                             ║
   ║  Edit these values to toggle features arcade-wide.         ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Master switch for all audio output.
 * Set to false to silence every playSound() call without
 * removing them from individual game files.
 */
let SOUND_ENABLED = true;

/**
 * Master volume for the Web Audio API oscillator sounds (0–1).
 * Individual sounds can override this via their own gain node.
 */
const MASTER_VOLUME = 0.18;

/**
 * Toast display duration in milliseconds.
 * Increase for slower readers, decrease for snappier feel.
 */
const TOAST_DURATION = 2800;

/**
 * LocalStorage namespace prefix.
 * All keys are stored as `${STORAGE_PREFIX}:gameName:key`.
 * Change this if you ever need to wipe all saved data cleanly.
 */
const STORAGE_PREFIX = 'neon_arcade';

/**
 * Paralax configuration defaults.
 * These mirror the CSS custom properties in style.css and can
 * be overridden per-scene by passing a config to initParallax().
 */
const PARALLAX_DEFAULTS = {
  farScrollMultiplier:  0.40,   // fraction of scrollY to shift the far grid
  nearScrollMultiplier: 0.70,   // fraction of scrollY to shift the near grid
  farMousePx:           18,     // max px travel for far layer on mousemove
  nearMousePx:          32,     // max px travel for near layer on mousemove
  shapeMousePx:         20,     // max px travel for floating shapes
  mouseLerp:            0.06,   // interpolation factor (0–1); lower = smoother
};


/* ╔══════════════════════════════════════════════════════════════╗
   ║  2. SOUND                                                   ║
   ║                                                             ║
   ║  Uses the Web Audio API to synthesize retro beeps without   ║
   ║  needing any external audio files. Replace individual        ║
   ║  entries in SOUND_MAP with { src: 'path/to/file.mp3' }      ║
   ║  objects once real assets are available.                     ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Lazily created AudioContext shared across all sounds.
 * @type {AudioContext|null}
 */
let _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended by browser autoplay policy
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

/**
 * Sound definition map.
 *
 * Each entry is either:
 *   { type, freq, duration, wave, gain }  → synthesized tone
 *   { src: 'path/to/audio.mp3' }          → real audio file
 *
 * HOW TO ADD A NEW SOUND:
 *   1. Add a key to SOUND_MAP below.
 *   2. Use { freq, duration, wave } for a quick synth sound, or
 *      provide { src } to load a real .mp3 / .ogg file.
 *   3. Call playSound('yourKey') anywhere in a game file.
 */
const SOUND_MAP = {
  // UI / navigation
  click:      { freq: 440,  duration: 0.06, wave: 'square',   gain: 0.12 },
  hover:      { freq: 660,  duration: 0.04, wave: 'sine',     gain: 0.06 },
  back:       { freq: 280,  duration: 0.08, wave: 'square',   gain: 0.10 },

  // Positive events
  score:      { freq: 880,  duration: 0.10, wave: 'sine',     gain: 0.14 },
  levelUp:    { freq: [523, 659, 784, 1047], duration: 0.12, wave: 'sine', gain: 0.14 },
  win:        { freq: [784, 988, 1175],      duration: 0.18, wave: 'sine', gain: 0.18 },
  bonus:      { freq: 1320, duration: 0.08, wave: 'sine',     gain: 0.14 },
  flip:       { freq: 600,  duration: 0.05, wave: 'triangle', gain: 0.10 },
  match:      { freq: [440, 880], duration: 0.09, wave: 'sine', gain: 0.14 },
  highScore:  { freq: [523, 659, 784, 1047, 1319], duration: 0.14, wave: 'sine', gain: 0.18 },

  // Negative events
  miss:       { freq: 220,  duration: 0.12, wave: 'sawtooth', gain: 0.12 },
  lose:       { freq: [440, 330, 220],      duration: 0.20, wave: 'sawtooth', gain: 0.16 },
  gameOver:   { freq: [330, 247, 196, 147], duration: 0.22, wave: 'sawtooth', gain: 0.18 },
  explode:    { freq: 80,   duration: 0.25, wave: 'sawtooth', gain: 0.20 },
  hit:        { freq: 160,  duration: 0.08, wave: 'square',   gain: 0.14 },

  // Ambient / movement
  move:       { freq: 520,  duration: 0.03, wave: 'square',   gain: 0.07 },
  drop:       { freq: 300,  duration: 0.07, wave: 'triangle', gain: 0.10 },
  beep:       { freq: 740,  duration: 0.05, wave: 'square',   gain: 0.10 },
  countdown:  { freq: 880,  duration: 0.08, wave: 'square',   gain: 0.12 },
  start:      { freq: [440, 550, 660], duration: 0.10, wave: 'sine', gain: 0.14 },

  // Extend this list freely ↑
};

/** Tracks pre-loaded HTMLAudioElement instances keyed by src path. */
const _audioCache = {};

/**
 * Play a named sound.
 *
 * @param {string} soundName  - Key from SOUND_MAP, e.g. 'score', 'gameOver'
 * @param {object} [options]  - Override { gain, playbackRate } per call
 *
 * @example
 *   playSound('score');
 *   playSound('levelUp', { gain: 0.5 });
 */
function playSound(soundName, options = {}) {
  if (!SOUND_ENABLED) return;

  const def = SOUND_MAP[soundName];
  if (!def) {
    console.warn(`[games.js] Unknown sound: "${soundName}". Add it to SOUND_MAP.`);
    return;
  }

  try {
    // Real audio file
    if (def.src) {
      _playAudioFile(def.src, options);
      return;
    }
    // Synthesized tone
    _playSynth(def, options);
  } catch (e) {
    // Never crash a game over audio
    console.warn('[games.js] Audio error:', e);
  }
}

/** Internal: play a synthesized retro beep. */
function _playSynth(def, options = {}) {
  const ctx  = _getAudioCtx();
  const gain = options.gain ?? def.gain ?? MASTER_VOLUME;
  const freqs = Array.isArray(def.freq) ? def.freq : [def.freq];
  const dur   = def.duration ?? 0.1;
  const wave  = def.wave ?? 'square';

  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const start = ctx.currentTime + i * dur * 0.9;

    osc.type            = wave;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.01);
  });
}

/** Internal: play a real audio file with caching. */
function _playAudioFile(src, options = {}) {
  if (!_audioCache[src]) {
    _audioCache[src] = new Audio(src);
  }
  const audio = _audioCache[src].cloneNode();
  audio.volume      = options.gain ?? MASTER_VOLUME;
  audio.playbackRate = options.playbackRate ?? 1;
  audio.play().catch(() => {});
}

/**
 * Toggle sound on/off globally.
 * @param {boolean} [force] - If provided, sets the value explicitly.
 * @returns {boolean} The new SOUND_ENABLED state.
 */
function toggleSound(force) {
  SOUND_ENABLED = (force !== undefined) ? Boolean(force) : !SOUND_ENABLED;
  return SOUND_ENABLED;
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  3. SCORE                                                   ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Update a score display element with a pop animation.
 * Automatically adds neon colour classes based on score growth.
 *
 * @param {HTMLElement} element  - The DOM node whose textContent to update
 * @param {number}      newScore - The new score value
 * @param {object}      [opts]
 * @param {boolean}     [opts.animate=true]    - Whether to play the pop animation
 * @param {string}      [opts.color='cyan']    - 'cyan' | 'pink' | 'purple' | 'yellow'
 * @param {boolean}     [opts.playAudio=true]  - Whether to trigger a score sound
 *
 * @example
 *   updateScore(document.getElementById('score'), 1500);
 *   updateScore(scoreEl, points, { color: 'pink', animate: true });
 */
function updateScore(element, newScore, opts = {}) {
  if (!element) return;

  const {
    animate   = true,
    color     = 'cyan',
    playAudio = true,
  } = opts;

  element.textContent = newScore.toLocaleString();

  if (animate) {
    // Remove then re-add class to re-trigger animation
    element.classList.remove('anim-score-pop');
    void element.offsetWidth; // force reflow
    element.classList.add('anim-score-pop');

    // Briefly boost the neon glow
    element.style.transition = 'text-shadow 0.05s ease';
    const glowMap = {
      cyan:   'var(--text-glow-cyan)',
      pink:   'var(--text-glow-pink)',
      purple: 'var(--text-glow-purple)',
      yellow: 'var(--glow-yellow)',
    };
    element.style.textShadow = glowMap[color] || glowMap.cyan;
    setTimeout(() => {
      element.style.textShadow = '';
      element.style.transition = '';
    }, 320);
  }

  if (playAudio) playSound('score');
}

/**
 * Animate a score counter rolling up from its current displayed value
 * to a target value over a given duration.
 *
 * @param {HTMLElement} element  - DOM node to update
 * @param {number}      target   - Final score value
 * @param {number}      [duration=800] - Roll duration in ms
 *
 * @example
 *   rollScore(scoreEl, 9999, 1200);
 */
function rollScore(element, target, duration = 800) {
  if (!element) return;

  const start    = parseInt(element.textContent.replace(/,/g, ''), 10) || 0;
  const range    = target - start;
  const startTime = performance.now();

  function tick(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = Math.round(start + range * eased);
    element.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
    else element.textContent = target.toLocaleString();
  }

  requestAnimationFrame(tick);
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  4. TOAST NOTIFICATIONS                                     ║
   ║                                                             ║
   ║  Requires .toast-container in the DOM (added automatically) ║
   ╚══════════════════════════════════════════════════════════════╝ */

/** Lazily created toast container element. */
let _toastContainer = null;

function _getToastContainer() {
  if (_toastContainer && document.body.contains(_toastContainer)) {
    return _toastContainer;
  }
  _toastContainer = document.createElement('div');
  _toastContainer.className = 'toast-container';
  _toastContainer.setAttribute('aria-live', 'polite');
  _toastContainer.setAttribute('aria-atomic', 'false');
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

/**
 * Show a temporary neon toast notification.
 *
 * @param {string} message      - Text to display
 * @param {object} [opts]
 * @param {string} [opts.variant='cyan']      - 'cyan' | 'pink' | 'purple'
 * @param {number} [opts.duration=TOAST_DURATION] - Auto-dismiss delay in ms
 * @param {string} [opts.icon='']             - Optional emoji / icon prefix
 * @param {string} [opts.sound='beep']        - Sound to play; '' to suppress
 *
 * @example
 *   showToast('Level Up!', { variant: 'pink', icon: '⚡' });
 *   showToast('High Score!', { variant: 'cyan', sound: 'highScore' });
 */
function showToast(message, opts = {}) {
  const {
    variant  = 'cyan',
    duration = TOAST_DURATION,
    icon     = '',
    sound    = 'beep',
  } = opts;

  const container = _getToastContainer();
  const toast     = document.createElement('div');

  toast.className   = `toast${variant !== 'cyan' ? ` toast--${variant}` : ''}`;
  toast.textContent = icon ? `${icon}  ${message}` : message;
  toast.setAttribute('role', 'status');

  container.appendChild(toast);
  if (sound) playSound(sound);

  // Auto-remove after duration + CSS out-animation time (300 ms)
  setTimeout(() => {
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    toast.style.animation = 'toastOut .3s var(--ease-smooth) forwards';
  }, duration);
}

/**
 * Show a full-screen flash overlay (for game-over, level-up moments).
 *
 * @param {string} [color='cyan'] - 'cyan' | 'pink' | 'purple'
 * @param {number} [duration=400] - Flash duration in ms
 */
function flashScreen(color = 'cyan', duration = 400) {
  const colorMap = {
    cyan:   'rgba(0,245,255,0.08)',
    pink:   'rgba(255,0,110,0.08)',
    purple: 'rgba(180,0,255,0.08)',
  };
  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed; inset:0; pointer-events:none; z-index:9000;
    background:${colorMap[color] || colorMap.cyan};
    animation:fadeIn .05s ease forwards;
  `;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.animation = 'fadeIn .3s ease reverse forwards';
    setTimeout(() => div.remove(), 300);
  }, duration);
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  5. HIGH SCORES & LOCAL STORAGE                             ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Build a namespaced localStorage key.
 * @param {string} gameName
 * @param {string} key
 * @returns {string}
 */
function _storageKey(gameName, key) {
  return `${STORAGE_PREFIX}:${gameName}:${key}`;
}

/**
 * Save a high score for a game.
 * Only updates if newScore is strictly greater than the stored value.
 *
 * @param {string} gameName - Unique game identifier, e.g. 'snake'
 * @param {number} score    - The score to (potentially) save
 * @returns {{ saved: boolean, previous: number, current: number }}
 *
 * @example
 *   const result = saveHighScore('snake', 4200);
 *   if (result.saved) showToast('New High Score! 🏆', { variant: 'pink' });
 */
function saveHighScore(gameName, score) {
  const previous = getHighScore(gameName);
  const isNew    = score > previous;

  if (isNew) {
    try {
      localStorage.setItem(_storageKey(gameName, 'highScore'), String(score));
      localStorage.setItem(_storageKey(gameName, 'highScoreDate'), new Date().toISOString());
    } catch (e) {
      console.warn('[games.js] localStorage write failed:', e);
    }
  }

  return { saved: isNew, previous, current: isNew ? score : previous };
}

/**
 * Get the stored high score for a game.
 *
 * @param {string} gameName
 * @returns {number} The high score, or 0 if none stored.
 *
 * @example
 *   const best = getHighScore('snake'); // e.g. 4200
 */
function getHighScore(gameName) {
  try {
    const raw = localStorage.getItem(_storageKey(gameName, 'highScore'));
    return raw !== null ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Clear the stored high score for a game.
 * @param {string} gameName
 */
function clearHighScore(gameName) {
  try {
    localStorage.removeItem(_storageKey(gameName, 'highScore'));
    localStorage.removeItem(_storageKey(gameName, 'highScoreDate'));
  } catch (e) {
    console.warn('[games.js] localStorage clear failed:', e);
  }
}

/**
 * Generic persistent storage helpers.
 * Use these to save any serialisable game state (settings, progress, etc.)
 *
 * @example
 *   saveGameData('tetris', 'settings', { level: 3, ghost: true });
 *   const s = loadGameData('tetris', 'settings');
 */
function saveGameData(gameName, key, value) {
  try {
    localStorage.setItem(_storageKey(gameName, key), JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[games.js] saveGameData failed:', e);
    return false;
  }
}

function loadGameData(gameName, key, fallback = null) {
  try {
    const raw = localStorage.getItem(_storageKey(gameName, key));
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function clearGameData(gameName, key) {
  try {
    if (key) {
      localStorage.removeItem(_storageKey(gameName, key));
    } else {
      // Clear all keys for this game
      const prefix = `${STORAGE_PREFIX}:${gameName}:`;
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k));
    }
  } catch (e) {
    console.warn('[games.js] clearGameData failed:', e);
  }
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  6. MATH / RANDOM HELPERS                                   ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Return a random integer in [min, max] (both inclusive).
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 *
 * @example
 *   randomInt(1, 6)  // simulates a die roll
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Return a random float in [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} array
 * @returns {T}
 *
 * @example
 *   randomFrom(['red', 'green', 'blue'])  // → 'green'
 */
function randomFrom(array) {
  return array[randomInt(0, array.length - 1)];
}

/**
 * Shuffle an array in-place using Fisher-Yates.
 * @template T
 * @param {T[]} array
 * @returns {T[]} The same (mutated) array.
 *
 * @example
 *   const deck = shuffle([1, 2, 3, 4, 5]);
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Clamp a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values.
 * @param {number} a  - Start value
 * @param {number} b  - End value
 * @param {number} t  - Progress factor (0–1)
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map a value from one range to another.
 * @example
 *   mapRange(0.5, 0, 1, 0, 100)  // → 50
 */
function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  7. FUNCTION UTILITIES                                      ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Debounce: delay execution until `wait` ms after the last call.
 * Useful for resize handlers, search inputs, etc.
 *
 * @param {Function} fn   - Function to debounce
 * @param {number}   wait - Delay in milliseconds
 * @returns {Function}
 *
 * @example
 *   window.addEventListener('resize', debounce(onResize, 200));
 */
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle: execute at most once per `limit` ms window.
 * Better than debounce for continuous events like mousemove.
 *
 * @param {Function} fn    - Function to throttle
 * @param {number}   limit - Minimum ms between calls
 * @returns {Function}
 *
 * @example
 *   canvas.addEventListener('mousemove', throttle(onMove, 16));
 */
function throttle(fn, limit) {
  let last = 0;
  return function (...args) {
    const now = performance.now();
    if (now - last >= limit) {
      last = now;
      fn.apply(this, args);
    }
  };
}

/**
 * Call `fn` once and discard all subsequent calls.
 * @param {Function} fn
 * @returns {Function}
 *
 * @example
 *   const initOnce = once(heavySetup);
 */
function once(fn) {
  let called = false, result;
  return function (...args) {
    if (!called) { called = true; result = fn.apply(this, args); }
    return result;
  };
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  8. DOM HELPERS                                             ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Shorthand querySelector — returns first match or null.
 * @param {string} selector
 * @param {Element|Document} [root=document]
 * @returns {Element|null}
 */
const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Shorthand querySelectorAll — returns a real Array.
 * @param {string} selector
 * @param {Element|Document} [root=document]
 * @returns {Element[]}
 */
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Create an element with optional classes, attributes, and text.
 *
 * @param {string} tag
 * @param {object} [opts]
 * @param {string|string[]} [opts.cls]   - class or array of classes
 * @param {object}          [opts.attrs] - key/value attributes
 * @param {string}          [opts.text]  - textContent
 * @param {string}          [opts.html]  - innerHTML (use carefully)
 * @returns {HTMLElement}
 *
 * @example
 *   const btn = createElement('button', { cls: 'neon-button', text: 'START' });
 */
function createElement(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.cls) {
    const classes = Array.isArray(opts.cls) ? opts.cls : opts.cls.split(' ');
    el.classList.add(...classes.filter(Boolean));
  }
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  }
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.html !== undefined) el.innerHTML   = opts.html;
  return el;
}

/**
 * Format a number of seconds as mm:ss.
 * @param {number} seconds
 * @returns {string}  e.g. '02:45'
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Pad a score number with leading zeros to a fixed width.
 * @param {number} score
 * @param {number} [width=6]
 * @returns {string}  e.g. '004200'
 */
function padScore(score, width = 6) {
  return String(score).padStart(width, '0');
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  9. PAGE TRANSITIONS                                        ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Navigate to a URL with a black flash transition.
 * Mirrors the behaviour in index.html so all game pages feel consistent.
 *
 * @param {string} url           - Destination URL
 * @param {number} [delay=280]   - Ms to show overlay before navigating
 *
 * @example
 *   navigateTo('../index.html');
 *   navigateTo('memory.html', 350);
 */
function navigateTo(url, delay = 280) {
  let overlay = document.getElementById('transition-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'transition-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:var(--bg-deep,#02020a);
      z-index:10000; pointer-events:none; opacity:0;
      transition:opacity .25s ease;
    `;
    document.body.appendChild(overlay);
  }
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    setTimeout(() => { window.location.href = url; }, delay);
  });
}

/**
 * Fade the page in on load. Call once at the top of each game script
 * or add data-page-transition to <body> to trigger automatically.
 */
function pageReveal() {
  const overlay = document.getElementById('transition-overlay');
  if (!overlay) return;
  overlay.style.cssText += 'opacity:1; transition:none;';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity .4s ease';
      overlay.style.opacity    = '0';
    });
  });
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  10. PARALLAX ENGINE                                        ║
   ║                                                             ║
   ║  Drives the parallax-scene from style.css.                  ║
   ║  Call initParallax() after DOMContentLoaded.               ║
   ║                                                             ║
   ║  Required HTML structure:                                   ║
   ║    <div class="parallax-scene">                            ║
   ║      <div class="parallax-layer layer-far"  id="layerFar"> ║
   ║      <div class="parallax-layer layer-near" id="layerNear">║
   ║      <div class="parallax-shapes" id="parallaxShapes">     ║
   ║    </div>                                                   ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Shape definition tuples for random floating SVG elements.
 * Each entry: [svgInner, width, height]
 * HOW TO ADD SHAPES: append a new tuple with any valid SVG content.
 */
const _SHAPE_DEFS = [
  [`<polygon points="30,0 60,52 0,52" fill="none" stroke="#00f5ff" stroke-width="1.5"/>`, 60, 52],
  [`<rect x="2" y="2" width="46" height="46" fill="none" stroke="#ff006e" stroke-width="1.5" transform="rotate(15,25,25)"/>`, 50, 50],
  [`<circle cx="25" cy="25" r="22" fill="none" stroke="#b400ff" stroke-width="1.5" stroke-dasharray="6,4"/>`, 50, 50],
  [`<polygon points="25,0 48,18 39,47 11,47 2,18" fill="none" stroke="#ffe600" stroke-width="1.2"/>`, 50, 47],
  [`<rect x="2" y="2" width="36" height="36" fill="rgba(180,0,255,0.05)" stroke="#b400ff" stroke-width="1"/>`, 40, 40],
  [`<line x1="0" y1="0" x2="60" y2="60" stroke="#ff006e" stroke-width="1" opacity=".7"/>
   <line x1="60" y1="0" x2="0"  y2="60" stroke="#ff006e" stroke-width="1" opacity=".7"/>`, 60, 60],
  [`<circle cx="20" cy="20" r="18" fill="none" stroke="#00f5ff" stroke-width="1" stroke-dasharray="3,6"/>`, 40, 40],
];

/**
 * Initialise the parallax background engine.
 *
 * @param {object} [config] - Override any PARALLAX_DEFAULTS key
 * @param {number} [shapeCount=16] - How many floating shapes to spawn
 *
 * @example
 *   // Minimal — picks up default DOM ids
 *   initParallax();
 *
 *   // Customise speed and shape count
 *   initParallax({ farMousePx: 10, nearScrollMultiplier: 0.3 }, 20);
 */
function initParallax(config = {}, shapeCount = 16) {
  const cfg = { ...PARALLAX_DEFAULTS, ...config };

  const layerFar    = document.getElementById('layerFar');
  const layerNear   = document.getElementById('layerNear');
  const shapesWrap  = document.getElementById('parallaxShapes');

  // Spawn random floating shapes
  if (shapesWrap) {
    for (let i = 0; i < shapeCount; i++) {
      const def    = _SHAPE_DEFS[i % _SHAPE_DEFS.length];
      const depth  = randomFloat(0.2, 1).toFixed(2);
      const scale  = randomFloat(0.5, 1.7).toFixed(2);
      const x      = randomFloat(-10, 110).toFixed(1);
      const y      = randomFloat(-10, 110).toFixed(1);
      const dur    = randomFloat(6, 14).toFixed(1);
      const delay  = randomFloat(0, 5).toFixed(1);
      const op     = randomFloat(0.06, 0.20).toFixed(2);

      const el = document.createElement('div');
      el.className       = 'parallax-shape';
      el.dataset.depth   = depth;
      el.style.cssText   = `
        left:${x}%; top:${y}%; opacity:${op};
        --float-dur:${dur}s; --float-delay:${delay}s;
      `;
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"
        width="${(def[1] * scale).toFixed(0)}"
        height="${(def[2] * scale).toFixed(0)}"
        viewBox="0 0 ${def[1]} ${def[2]}">${def[0]}</svg>`;
      shapesWrap.appendChild(el);
    }
  }

  // Mouse + scroll tracking with lerp
  let mx = 0, my = 0, tx = 0, ty = 0;
  let raf = null;

  const tick = () => {
    raf = null;
    tx += (mx - tx) * cfg.mouseLerp;
    ty += (my - ty) * cfg.mouseLerp;
    const scroll = window.scrollY;

    if (layerFar) {
      layerFar.style.transform =
        `translate(${tx * cfg.farMousePx}px, ${ty * cfg.farMousePx - scroll * cfg.farScrollMultiplier}px)`;
    }
    if (layerNear) {
      layerNear.style.transform =
        `translate(${tx * cfg.nearMousePx}px, ${ty * cfg.nearMousePx - scroll * cfg.nearScrollMultiplier}px)`;
    }

    // Shapes move at their individual depth
    if (shapesWrap) {
      shapesWrap.querySelectorAll('.parallax-shape').forEach(s => {
        const d = parseFloat(s.dataset.depth) || 1;
        s.style.transform =
          `translate(${tx * cfg.shapeMousePx * d}px, ${ty * cfg.shapeMousePx * d - scroll * d * 0.5}px)`;
      });
    }

    if (Math.abs(mx - tx) > 0.001 || Math.abs(my - ty) > 0.001) {
      raf = requestAnimationFrame(tick);
    }
  };

  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };

  document.addEventListener('mousemove', e => {
    mx = (e.clientX / window.innerWidth  - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
    schedule();
  });
  window.addEventListener('scroll', schedule, { passive: true });
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  11. GAME LOOP HELPER                                       ║
   ║                                                             ║
   ║  A minimal fixed-timestep game loop so each game doesn't    ║
   ║  need to re-implement requestAnimationFrame boilerplate.    ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Create a pausable game loop.
 *
 * @param {object} handlers
 * @param {Function} handlers.update  - Called with (deltaMs) each tick
 * @param {Function} handlers.render  - Called after update each tick
 * @param {number}  [targetFps=60]    - Target frames per second
 * @returns {{ start, stop, pause, resume, isPaused }}
 *
 * @example
 *   const loop = createGameLoop({
 *     update(dt) { player.move(dt); },
 *     render()   { draw(); },
 *   });
 *   loop.start();
 */
function createGameLoop({ update, render }, targetFps = 60) {
  const frameDuration = 1000 / targetFps;
  let   rafId      = null;
  let   lastTime   = 0;
  let   _paused    = false;
  let   accumulator = 0;

  function loop(timestamp) {
    rafId = requestAnimationFrame(loop);
    if (_paused) return;

    const delta = Math.min(timestamp - lastTime, 100); // cap at 100 ms to handle tab-switch
    lastTime    = timestamp;
    accumulator += delta;

    while (accumulator >= frameDuration) {
      if (typeof update === 'function') update(frameDuration);
      accumulator -= frameDuration;
    }

    if (typeof render === 'function') render();
  }

  return {
    start()   { lastTime = performance.now(); rafId = requestAnimationFrame(loop); },
    stop()    { if (rafId) cancelAnimationFrame(rafId); rafId = null; },
    pause()   { _paused = true;  },
    resume()  { _paused = false; },
    isPaused: () => _paused,
  };
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  12. KEYBOARD MANAGER                                       ║
   ╚══════════════════════════════════════════════════════════════╝ */

/**
 * Lightweight keyboard state tracker.
 * Tracks which keys are currently held down.
 *
 * @example
 *   const keys = createKeyboard();
 *   // In game loop:
 *   if (keys.pressed('ArrowLeft')) player.moveLeft();
 *   // Clean up on game over:
 *   keys.destroy();
 */
function createKeyboard() {
  const held = new Set();
  const _down = e => held.add(e.code);
  const _up   = e => held.delete(e.code);
  window.addEventListener('keydown', _down);
  window.addEventListener('keyup',   _up);
  return {
    pressed:  code => held.has(code),
    any:      (...codes) => codes.some(c => held.has(c)),
    clear:    () => held.clear(),
    destroy:  () => {
      window.removeEventListener('keydown', _down);
      window.removeEventListener('keyup',   _up);
    },
  };
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  13. AUTO-INIT                                              ║
   ║                                                             ║
   ║  When the DOM is ready, wire up any opt-in behaviours       ║
   ║  driven purely by HTML attributes — no extra JS needed.     ║
   ╚══════════════════════════════════════════════════════════════╝ */

document.addEventListener('DOMContentLoaded', () => {

  // Page reveal transition
  pageReveal();

  // data-navigate="url" — neon page transition on any element
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-navigate]');
    if (!el) return;
    e.preventDefault();
    playSound('click');
    navigateTo(el.dataset.navigate);
  });

  // data-sound="name" — play a sound on click without extra JS
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-sound]');
    if (el) playSound(el.dataset.sound);
  });

  // data-back — go back in history with transition
  document.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) {
      playSound('back');
      navigateTo('../index.html');
    }
  });

  // Auto-init parallax if the required DOM nodes are present
  if (document.getElementById('layerFar')) {
    initParallax();
  }
});


/* ╔══════════════════════════════════════════════════════════════╗
   ║  14. PUBLIC API EXPORT                                      ║
   ║                                                             ║
   ║  Everything listed here is available globally AND via the   ║
   ║  NeonArcade namespace for module-aware consumers.           ║
   ╚══════════════════════════════════════════════════════════════╝ */

window.NeonArcade = {
  // Config
  get SOUND_ENABLED()  { return SOUND_ENABLED; },
  set SOUND_ENABLED(v) { SOUND_ENABLED = Boolean(v); },
  SOUND_MAP,
  STORAGE_PREFIX,
  PARALLAX_DEFAULTS,

  // Sound
  playSound,
  toggleSound,

  // Score
  updateScore,
  rollScore,

  // UI
  showToast,
  flashScreen,

  // Storage
  saveHighScore,
  getHighScore,
  clearHighScore,
  saveGameData,
  loadGameData,
  clearGameData,

  // Math
  randomInt,
  randomFloat,
  randomFrom,
  shuffle,
  clamp,
  lerp,
  mapRange,

  // Function utilities
  debounce,
  throttle,
  once,

  // DOM
  $,
  $$,
  createElement,
  formatTime,
  padScore,

  // Navigation
  navigateTo,
  pageReveal,

  // Parallax
  initParallax,

  // Game loop
  createGameLoop,

  // Input
  createKeyboard,
};

// Also expose helpers at global scope for convenience in simple game files
Object.assign(window, {
  playSound, updateScore, rollScore, showToast, flashScreen,
  saveHighScore, getHighScore, saveGameData, loadGameData,
  randomInt, randomFloat, randomFrom, shuffle, clamp, lerp, mapRange,
  debounce, throttle, once, formatTime, padScore,
  navigateTo, initParallax, createGameLoop, createKeyboard,
});