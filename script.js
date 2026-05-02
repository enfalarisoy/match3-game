// ─── Constants ────────────────────────────────────────────────────────────────
const boardSize = 8;
const colorCount = 6;
const startingMoves = 24;
const matchScore = 10;
const startingObstacles = 12;
const previewFollowFactor = 0.68;
const previewMaxOffset = 28;
const previewSmoothing = 0.26;
const previewPairFollowFactor = 0.55;
const previewPrimaryTravelRatio = 0.92;
const previewCrossAxisLimit = 18;
const swapMinDuration = 185;
const swapMaxDuration = 340;
const fallBaseDuration = 260;
const fallPerRowMs = 44;
const hintDuration = 2200;

// ─── DOM References ───────────────────────────────────────────────────────────
const appElement = document.getElementById("app");
const mainMenuElement = document.getElementById("main-menu");
const menuViews = document.querySelectorAll(".menu-view");
const startButton = document.getElementById("start-game");
const openHowToPlayButton = document.getElementById("open-how-to-play");
const howToPlayBackButton = document.getElementById("how-to-play-back");
const openCreditsButton = document.getElementById("open-credits");
const creditsBackButton = document.getElementById("credits-back");
const boardElement = document.getElementById("board");
const boardWrapElement = document.querySelector(".board-wrap");
const celebrationElement = document.getElementById("celebration");
const celebrationTextElement = document.getElementById("celebration-text");
const flyingBonusElement = document.getElementById("flying-bonus");
const scoreElement = document.getElementById("score");
const obstaclesElement = document.getElementById("obstacles");
const movesElement = document.getElementById("moves");
const movesPanelElement = document.getElementById("moves-panel");
const statusElement = document.getElementById("status");
const menuButton = document.getElementById("menu-button");
const restartButton = document.getElementById("restart");
const hintButton = document.getElementById("hint-button");
const muteButton = document.getElementById("mute-button");
const gameOverModal = document.getElementById("game-over-modal");
const gameOverTitle = document.getElementById("game-over-title");
const gameOverMessage = document.getElementById("game-over-message");
const gameOverPlayAgain = document.getElementById("game-over-play-again");
const gameOverMenuBtn = document.getElementById("game-over-menu-btn");

// ─── State ────────────────────────────────────────────────────────────────────
let board = [];
let obstacles = [];
let score = 0;
let movesLeft = startingMoves;
let locked = false;
let gameFinished = false;
let pointerStart = null;
let celebrationTimeout = null;
let flyingBonusTimeout = null;
let activeSwapCleanup = null;
let previewState = null;
let hintIndices = [];
let hintTimeout = null;
let highScore = parseInt(localStorage.getItem("match3HighScore") || "0", 10);
let boardImpactTimeout = null;

// ─── Audio (Web Audio API — no external files) ────────────────────────────────
let audioCtx = null;
let soundMuted = false;
let audioResumePromise = null;

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      return null;
    }
  }
  return audioCtx;
}

async function ensureAudioReady() {
  const ctx = getAudioCtx();
  if (!ctx) {
    return null;
  }

  if (ctx.state === "running") {
    return ctx;
  }

  if (!audioResumePromise) {
    audioResumePromise = ctx.resume().catch(() => null).finally(() => {
      audioResumePromise = null;
    });
  }

  await audioResumePromise;
  return ctx.state === "running" ? ctx : null;
}

function unlockAudioFromGesture() {
  void ensureAudioReady();
}

function tone(ctx, freq, type, peak, start, end, freqEnd = null) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd !== null) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, end);
  }
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  osc.start(start);
  osc.stop(end + 0.04);
}

function scheduleSound(ctx, name, extra = 0) {
  const t = ctx.currentTime;

  if (name === "swap") {
    tone(ctx, 420, "sine", 0.13, t, t + 0.09, 520);
  } else if (name === "noMatch") {
    tone(ctx, 180, "sawtooth", 0.11, t, t + 0.15, 140);
  } else if (name === "match") {
    tone(ctx, 270, "triangle", 0.15, t, t + 0.14, 420);
    tone(ctx, 540, "sine", 0.08, t + 0.05, t + 0.21, 680);
  } else if (name === "cascade") {
    const f = 300 + extra * 90;
    tone(ctx, f, "triangle", 0.14, t, t + 0.16, f * 1.45);
  } else if (name === "bonus") {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(ctx, f, "sine", 0.14, t + i * 0.09, t + i * 0.09 + 0.2)
    );
  } else if (name === "win") {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(ctx, f, "sine", 0.17, t + i * 0.13, t + i * 0.13 + 0.28)
    );
  } else if (name === "lose") {
    [440, 370, 311, 261].forEach((f, i) =>
      tone(ctx, f, "sawtooth", 0.13, t + i * 0.13, t + i * 0.13 + 0.24)
    );
  } else if (name === "hint") {
    tone(ctx, 880, "sine", 0.1, t, t + 0.13);
    tone(ctx, 1108, "sine", 0.07, t + 0.11, t + 0.25);
  } else if (name === "shuffle") {
    for (let i = 0; i < 7; i++) {
      const f = 180 + Math.random() * 560;
      tone(ctx, f, "sine", 0.05, t + i * 0.045, t + i * 0.045 + 0.065);
    }
  }
}

function playSound(name, extra = 0) {
  if (soundMuted) {
    return;
  }

  const ctx = getAudioCtx();
  if (!ctx) {
    return;
  }

  if (ctx.state !== "running") {
    void ensureAudioReady().then((readyCtx) => {
      if (readyCtx && !soundMuted) {
        scheduleSound(readyCtx, name, extra);
      }
    });
    return;
  }

  scheduleSound(ctx, name, extra);
}

// ─── Scroll helpers ───────────────────────────────────────────────────────────
function getScrollPosition() {
  return { x: window.scrollX, y: window.scrollY };
}

function restoreScrollPosition(pos) {
  if (pos && (window.scrollX !== pos.x || window.scrollY !== pos.y)) {
    window.scrollTo(pos.x, pos.y);
  }
}

function clearBoardImpact() {
  if (boardImpactTimeout) {
    window.clearTimeout(boardImpactTimeout);
    boardImpactTimeout = null;
  }

  if (boardWrapElement) {
    boardWrapElement.classList.remove("board-impact-active");
    boardWrapElement.style.removeProperty("--impact-duration");
    boardWrapElement.style.removeProperty("--impact-x1");
    boardWrapElement.style.removeProperty("--impact-x2");
    boardWrapElement.style.removeProperty("--impact-x3");
    boardWrapElement.style.removeProperty("--impact-x4");
    boardWrapElement.style.removeProperty("--impact-y2");
    boardWrapElement.style.removeProperty("--impact-y3");
    boardWrapElement.style.removeProperty("--impact-y4");
  }
}

function triggerBoardImpact(blastCount) {
  if (!boardWrapElement || blastCount < 2) {
    return;
  }

  const cascadeDepth = Math.min(blastCount - 1, 5);
  const strength = 1 + (cascadeDepth - 1) * 0.34;
  const duration = Math.round(340 + cascadeDepth * 24);

  clearBoardImpact();
  boardWrapElement.style.setProperty("--impact-duration", `${duration}ms`);
  boardWrapElement.style.setProperty("--impact-x1", `${(-4 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-x2", `${(3.4 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-x3", `${(-2.7 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-x4", `${(1.8 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-y2", `${(-1.3 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-y3", `${(1.7 * strength).toFixed(2)}px`);
  boardWrapElement.style.setProperty("--impact-y4", `${(-0.9 * strength).toFixed(2)}px`);
  void boardWrapElement.offsetWidth;
  boardWrapElement.classList.add("board-impact-active");
  boardImpactTimeout = window.setTimeout(() => {
    boardWrapElement.classList.remove("board-impact-active");
    boardImpactTimeout = null;
  }, duration);
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
function showMenuView(viewId) {
  menuViews.forEach((view) => {
    const isActive = view.id === viewId;
    view.classList.toggle("active", isActive);
    view.setAttribute("aria-hidden", String(!isActive));
  });
}

function openGameFromMenu() {
  showMenuView("menu-home");
  mainMenuElement.classList.add("hidden");
  appElement.classList.add("active");
  appElement.setAttribute("aria-hidden", "false");
  startGame();
}

function returnToMenu() {
  cleanupActiveSwap();
  hideGameOverModal();
  clearBoardImpact();
  mainMenuElement.classList.remove("hidden");
  appElement.classList.remove("active");
  appElement.setAttribute("aria-hidden", "true");
  showMenuView("menu-home");
  setStatus("Press Start Game to begin.");
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function randomColor() {
  return Math.floor(Math.random() * colorCount);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function indexToRowCol(index) {
  return { row: Math.floor(index / boardSize), col: index % boardSize };
}

function isAdjacent(a, b) {
  const ar = indexToRowCol(a);
  const br = indexToRowCol(b);
  return Math.abs(ar.row - br.row) + Math.abs(ar.col - br.col) === 1;
}

function swapTiles(a, b) {
  [board[a], board[b]] = [board[b], board[a]];
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ─── Tile geometry ────────────────────────────────────────────────────────────
function getTileSlotPosition(tile) {
  return {
    left: tile.offsetLeft,
    top: tile.offsetTop,
    width: tile.offsetWidth,
    height: tile.offsetHeight
  };
}

function getTileLivePosition(tile, boardRect) {
  const r = tile.getBoundingClientRect();
  return {
    left: r.left - boardRect.left,
    top: r.top - boardRect.top,
    width: r.width,
    height: r.height
  };
}

function getTileMotion(ox, oy) {
  return {
    rotateX: clamp(-oy * 0.1, -2.4, 2.4),
    rotateY: clamp(ox * 0.1, -2.4, 2.4),
    rotateZ: clamp(ox * 0.14, -3.2, 3.2),
    scale: 1
  };
}

function buildTileTransform(ox, oy, motion = {}) {
  const { rotateX = 0, rotateY = 0, rotateZ = 0, scale = 1 } = motion;
  return `translate3d(${ox}px, ${oy}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`;
}

function applyTilePreviewTransform(tile, ox, oy) {
  tile.style.transform = buildTileTransform(ox, oy, getTileMotion(ox, oy));
}

// ─── Drag preview system ──────────────────────────────────────────────────────
function getPreviewMotionForTile(tile) {
  if (!previewState) return null;
  if (previewState.tile === tile) return getTileMotion(previewState.currentX, previewState.currentY);
  if (previewState.pairTile === tile) return getTileMotion(previewState.pairCurrentX, previewState.pairCurrentY);
  return null;
}

function resetPreviewTile(tile) {
  if (!tile) return;
  tile.classList.remove("tile-previewing");
  tile.style.removeProperty("transform");
}

function stopTilePreview(immediate = false) {
  if (!previewState) return;
  if (immediate) {
    if (previewState.rafId) window.cancelAnimationFrame(previewState.rafId);
    resetPreviewTile(previewState.tile);
    resetPreviewTile(previewState.pairTile);
    previewState = null;
    return;
  }
  previewState.targetX = 0;
  previewState.targetY = 0;
  previewState.pairTargetX = 0;
  previewState.pairTargetY = 0;
  previewState.releasing = true;
}

function consumeTilePreviewForSwap(tile) {
  if (!previewState || previewState.tile !== tile) return false;
  if (previewState.rafId) window.cancelAnimationFrame(previewState.rafId);
  resetPreviewTile(previewState.tile);
  resetPreviewTile(previewState.pairTile);
  previewState = null;
  return true;
}

function tickTilePreview() {
  if (!previewState) return;

  previewState.currentX += (previewState.targetX - previewState.currentX) * previewSmoothing;
  previewState.currentY += (previewState.targetY - previewState.currentY) * previewSmoothing;
  previewState.pairCurrentX += (previewState.pairTargetX - previewState.pairCurrentX) * previewSmoothing;
  previewState.pairCurrentY += (previewState.pairTargetY - previewState.pairCurrentY) * previewSmoothing;

  applyTilePreviewTransform(previewState.tile, previewState.currentX, previewState.currentY);
  if (previewState.pairTile) {
    previewState.pairTile.classList.add("tile-previewing");
    applyTilePreviewTransform(previewState.pairTile, previewState.pairCurrentX, previewState.pairCurrentY);
  }

  const close =
    Math.abs(previewState.currentX - previewState.targetX) < 0.2 &&
    Math.abs(previewState.currentY - previewState.targetY) < 0.2 &&
    Math.abs(previewState.pairCurrentX - previewState.pairTargetX) < 0.2 &&
    Math.abs(previewState.pairCurrentY - previewState.pairTargetY) < 0.2;

  if (previewState.releasing && close) {
    resetPreviewTile(previewState.tile);
    resetPreviewTile(previewState.pairTile);
    previewState = null;
    return;
  }

  previewState.rafId = window.requestAnimationFrame(tickTilePreview);
}

function updateTilePreview(tile, deltaX, deltaY) {
  if (!tile) return;

  // Pass threshold=6 so the preview pair activates at a smaller drag distance
  const previewTargetIndex = pointerStart
    ? findSwipeTarget(pointerStart.index, deltaX, deltaY, 6)
    : null;
  const pairTile = previewTargetIndex !== null
    ? boardElement.querySelector(`[data-index="${previewTargetIndex}"]`)
    : null;

  let previewX = clamp(deltaX * previewFollowFactor, -previewMaxOffset, previewMaxOffset);
  let previewY = clamp(deltaY * previewFollowFactor, -previewMaxOffset, previewMaxOffset);
  let pairTargetX = 0;
  let pairTargetY = 0;

  if (pairTile) {
    const tileSlot = getTileSlotPosition(tile);
    const pairSlot = getTileSlotPosition(pairTile);
    const sdX = pairSlot.left - tileSlot.left;
    const sdY = pairSlot.top - tileSlot.top;

    if (Math.abs(sdX) > Math.abs(sdY)) {
      const maxPX = Math.abs(sdX) * previewPrimaryTravelRatio;
      previewX = clamp(deltaX * previewFollowFactor, -maxPX, maxPX);
      previewY = clamp(deltaY * previewFollowFactor, -previewCrossAxisLimit, previewCrossAxisLimit);
      pairTargetX = clamp(-previewX * previewPairFollowFactor, -maxPX, maxPX);
    } else {
      const maxPY = Math.abs(sdY) * previewPrimaryTravelRatio;
      previewY = clamp(deltaY * previewFollowFactor, -maxPY, maxPY);
      previewX = clamp(deltaX * previewFollowFactor, -previewCrossAxisLimit, previewCrossAxisLimit);
      pairTargetY = clamp(-previewY * previewPairFollowFactor, -maxPY, maxPY);
    }
  }

  if (!previewState || previewState.tile !== tile) {
    stopTilePreview(true);
    tile.classList.add("tile-previewing");
    previewState = {
      tile,
      pairTile,
      targetX: previewX,
      targetY: previewY,
      pairTargetX,
      pairTargetY,
      currentX: 0,
      currentY: 0,
      pairCurrentX: 0,
      pairCurrentY: 0,
      rafId: 0,
      releasing: false
    };
    tickTilePreview();
    return;
  }

  if (previewState.pairTile && previewState.pairTile !== pairTile) {
    resetPreviewTile(previewState.pairTile);
    previewState.pairCurrentX = 0;
    previewState.pairCurrentY = 0;
  }
  previewState.pairTile = pairTile;
  previewState.targetX = previewX;
  previewState.targetY = previewY;
  previewState.pairTargetX = pairTargetX;
  previewState.pairTargetY = pairTargetY;
  previewState.releasing = false;
}

// ─── Swap animation ───────────────────────────────────────────────────────────
function createSwapClone(sourceTile, position, motion = null) {
  const clone = sourceTile.cloneNode(true);
  clone.classList.remove("swap-hidden");
  clone.removeAttribute("data-index");
  clone.setAttribute("aria-hidden", "true");
  clone.tabIndex = -1;
  clone.classList.add("swap-clone");
  clone.style.left = `${position.left}px`;
  clone.style.top = `${position.top}px`;
  clone.style.width = `${position.width}px`;
  clone.style.height = `${position.height}px`;
  if (motion) clone.style.transform = buildTileTransform(0, 0, motion);
  return clone;
}

function cleanupActiveSwap() {
  stopTilePreview(true);
  if (activeSwapCleanup) {
    activeSwapCleanup();
    activeSwapCleanup = null;
  }
}

async function animateSwapMove(fromIndex, toIndex, options = {}) {
  const fromTile = boardElement.querySelector(`[data-index="${fromIndex}"]`);
  const toTile = boardElement.querySelector(`[data-index="${toIndex}"]`);
  if (!fromTile || !toTile) return;

  const continueFromPreview = options.continueFromPreview && previewState?.tile === fromTile;
  if (!continueFromPreview) stopTilePreview(true);
  if (activeSwapCleanup) { activeSwapCleanup(); activeSwapCleanup = null; }

  const boardRect = boardElement.getBoundingClientRect();
  const toCFP = continueFromPreview && previewState?.pairTile === toTile;
  const fromStartMotion = continueFromPreview ? getPreviewMotionForTile(fromTile) : null;
  const toStartMotion = toCFP ? getPreviewMotionForTile(toTile) : null;
  const fromStart = continueFromPreview ? getTileLivePosition(fromTile, boardRect) : getTileSlotPosition(fromTile);
  const toStart = toCFP ? getTileLivePosition(toTile, boardRect) : getTileSlotPosition(toTile);
  const fromTarget = getTileSlotPosition(toTile);
  const toTarget = getTileSlotPosition(fromTile);
  const fromSlot = getTileSlotPosition(fromTile);
  const fullDistance = Math.max(
    Math.hypot(fromTarget.left - fromSlot.left, fromTarget.top - fromSlot.top),
    1
  );
  const remainingDistance = Math.max(
    Math.hypot(fromTarget.left - fromStart.left, fromTarget.top - fromStart.top),
    Math.hypot(toTarget.left - toStart.left, toTarget.top - toStart.top)
  );
  const remainingRatio = clamp(remainingDistance / fullDistance, 0, 1);
  const duration = Math.round(swapMinDuration + (swapMaxDuration - swapMinDuration) * remainingRatio);
  const easing = "cubic-bezier(0.16, 1, 0.3, 1)";

  const fromClone = createSwapClone(fromTile, fromStart, fromStartMotion);
  const toClone = createSwapClone(toTile, toStart, toStartMotion);
  boardElement.appendChild(fromClone);
  boardElement.appendChild(toClone);
  if (continueFromPreview) consumeTilePreviewForSwap(fromTile);
  fromTile.classList.add("swap-hidden");
  toTile.classList.add("swap-hidden");

  activeSwapCleanup = () => {
    fromClone.remove();
    toClone.remove();
    fromTile.classList.remove("swap-hidden");
    toTile.classList.remove("swap-hidden");
  };

  const swapFrames = (x, y, startMotion = null) => {
    const init = startMotion ?? { rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 };
    const carryX = x * 0.28;
    const carryY = y * 0.28;
    const settleX = x * 1.02;
    const settleY = y * 1.02;
    const travelMotion = {
      rotateX: clamp(init.rotateX * 0.55 - y * 0.018, -2.2, 2.2),
      rotateY: clamp(init.rotateY * 0.55 + x * 0.018, -2.2, 2.2),
      rotateZ: clamp(init.rotateZ * 0.45 + x * 0.022, -2.8, 2.8),
      scale: 1.015
    };
    const settleMotion = {
      rotateX: clamp(-y * 0.008, -0.9, 0.9),
      rotateY: clamp(x * 0.008, -0.9, 0.9),
      rotateZ: clamp(x * 0.01, -0.8, 0.8),
      scale: 1.008
    };
    return [
      { transform: buildTileTransform(0, 0, init), offset: 0 },
      { transform: buildTileTransform(carryX, carryY, travelMotion), offset: 0.24 },
      { transform: buildTileTransform(settleX, settleY, settleMotion), offset: 0.84 },
      { transform: buildTileTransform(x, y), offset: 1 }
    ];
  };

  const fromAnimation = fromClone.animate(
    swapFrames(fromTarget.left - fromStart.left, fromTarget.top - fromStart.top, fromStartMotion),
    { duration, easing, fill: "forwards" }
  );
  const toAnimation = toClone.animate(
    swapFrames(toTarget.left - toStart.left, toTarget.top - toStart.top, toStartMotion),
    { duration, easing, fill: "forwards" }
  );

  try {
    await Promise.all([fromAnimation.finished, toAnimation.finished]);
  } finally {
    activeSwapCleanup = null;
  }
}

// ─── Board queries ────────────────────────────────────────────────────────────
function countRemainingObstacles() {
  return obstacles.filter(Boolean).length;
}

function getOrthogonalNeighbors(index) {
  const { row, col } = indexToRowCol(index);
  const neighbors = [];
  if (row > 0) neighbors.push(index - boardSize);
  if (row < boardSize - 1) neighbors.push(index + boardSize);
  if (col > 0) neighbors.push(index - 1);
  if (col < boardSize - 1) neighbors.push(index + 1);
  return neighbors;
}

function expandAdjacentColorBlast(matched, boardState = board) {
  const expanded = new Set(matched);
  const queue = [...matched];
  while (queue.length > 0) {
    const current = queue.shift();
    const color = boardState[current];
    if (color === null) continue;
    getOrthogonalNeighbors(current).forEach((n) => {
      if (!expanded.has(n) && boardState[n] === color) {
        expanded.add(n);
        queue.push(n);
      }
    });
  }
  return [...expanded];
}

function findMatches(boardState = board) {
  const matched = new Set();

  for (let row = 0; row < boardSize; row += 1) {
    let streak = 1;
    for (let col = 1; col <= boardSize; col += 1) {
      const currentIndex = row * boardSize + col;
      const prevIndex = row * boardSize + col - 1;
      const currentValue = col < boardSize ? boardState[currentIndex] : null;
      const prevValue = boardState[prevIndex];
      if (currentValue !== null && currentValue === prevValue) {
        streak += 1;
      } else {
        if (streak >= 3) {
          for (let offset = 0; offset < streak; offset += 1) {
            matched.add(prevIndex - offset);
          }
        }
        streak = 1;
      }
    }
  }

  for (let col = 0; col < boardSize; col += 1) {
    let streak = 1;
    for (let row = 1; row <= boardSize; row += 1) {
      const currentIndex = row < boardSize ? row * boardSize + col : null;
      const prevIndex = (row - 1) * boardSize + col;
      const currentValue = row < boardSize ? boardState[currentIndex] : null;
      const prevValue = boardState[prevIndex];
      if (currentValue !== null && currentValue === prevValue) {
        streak += 1;
      } else {
        if (streak >= 3) {
          for (let offset = 0; offset < streak; offset += 1) {
            matched.add(prevIndex - offset * boardSize);
          }
        }
        streak = 1;
      }
    }
  }

  for (let row = 0; row < boardSize - 1; row += 1) {
    for (let col = 0; col < boardSize - 1; col += 1) {
      const topLeft = row * boardSize + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + boardSize;
      const bottomRight = bottomLeft + 1;
      const color = boardState[topLeft];
      if (
        color !== null &&
        color === boardState[topRight] &&
        color === boardState[bottomLeft] &&
        color === boardState[bottomRight]
      ) {
        matched.add(topLeft);
        matched.add(topRight);
        matched.add(bottomLeft);
        matched.add(bottomRight);
      }
    }
  }

  return expandAdjacentColorBlast([...matched], boardState);
}

// ─── Tile fall animation ──────────────────────────────────────────────────────
// Builds a map of newIndex → { fromRow } describing where each tile came from.
// Survivors fall downward; new tiles enter from above (fromRow < 0).
function computeFallData(currentBoard, clearedSet) {
  const fallData = new Map();

  for (let col = 0; col < boardSize; col++) {
    const survivors = [];
    for (let row = 0; row < boardSize; row++) {
      const idx = row * boardSize + col;
      if (!clearedSet.has(idx) && currentBoard[idx] !== null) {
        survivors.push(row);
      }
    }
    const emptyCount = boardSize - survivors.length;

    survivors.forEach((oldRow, i) => {
      const newRow = emptyCount + i;
      fallData.set(newRow * boardSize + col, { fromRow: oldRow });
    });

    // New tiles: fromRow < 0 means they start above the board.
    // The furthest-above tile lands at row 0, the next at row 1, etc.
    for (let i = 0; i < emptyCount; i++) {
      fallData.set(i * boardSize + col, { fromRow: -(emptyCount - i) });
    }
  }

  return fallData;
}

async function animateBoardFall(fallData) {
  renderBoard();

  const firstTile = boardElement.querySelector(".tile");
  if (!firstTile) return;

  const tileH = firstTile.offsetHeight;
  const boardGap = parseInt(window.getComputedStyle(boardElement).gap) || 8;
  const rowStep = tileH + boardGap;
  const anims = [];

  boardElement.querySelectorAll(".tile").forEach((tile) => {
    const index = parseInt(tile.dataset.index);
    const entry = fallData.get(index);
    if (!entry) return;

    const { row: toRow } = indexToRowCol(index);
    const { col } = indexToRowCol(index);
    const fromRow = entry.fromRow;
    const rowDiff = fromRow - toRow; // negative → tile was above its final spot
    if (rowDiff === 0) return;

    const offsetY = rowDiff * rowStep;
    const isNew = fromRow < 0;
    const fallRows = Math.abs(rowDiff);
    const duration = fallBaseDuration + fallRows * fallPerRowMs;
    const delay = isNew ? col * 14 : 0; // stagger new tiles by column

    const anim = tile.animate(
      [
        { transform: `translateY(${offsetY}px)`, opacity: isNew ? 0 : 1 },
        { transform: "translateY(0px)", opacity: 1 }
      ],
      { duration, delay, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
    anims.push(anim.finished);
  });

  if (anims.length > 0) await Promise.all(anims);
}

// ─── Refill ───────────────────────────────────────────────────────────────────
function refillBoard(boardState = board) {
  for (let col = 0; col < boardSize; col += 1) {
    const values = [];
    for (let row = boardSize - 1; row >= 0; row -= 1) {
      const index = row * boardSize + col;
      if (boardState[index] !== null) {
        values.push(boardState[index]);
      }
    }
    while (values.length < boardSize) {
      values.push(randomColor());
    }
    for (let row = boardSize - 1, pointer = 0; row >= 0; row -= 1, pointer += 1) {
      boardState[row * boardSize + col] = values[pointer];
    }
  }
}

// ─── Valid-move detection & shuffle ──────────────────────────────────────────
// Tries every possible adjacent swap and checks whether it produces a match.
function findValidMove() {
  for (let i = 0; i < boardSize * boardSize; i++) {
    const { row, col } = indexToRowCol(i);
    if (col < boardSize - 1) {
      swapTiles(i, i + 1);
      const has = findMatches().length > 0;
      swapTiles(i, i + 1);
      if (has) return [i, i + 1];
    }
    if (row < boardSize - 1) {
      swapTiles(i, i + boardSize);
      const has = findMatches().length > 0;
      swapTiles(i, i + boardSize);
      if (has) return [i, i + boardSize];
    }
  }
  return null;
}

// Quick check: would placing `color` at `index` create a 3-in-a-row/column?
function couldCauseMatch(index, color) {
  const { row, col } = indexToRowCol(index);
  let h = 1;
  let c = col - 1;
  while (c >= 0 && board[row * boardSize + c] === color) { h++; c--; }
  c = col + 1;
  while (c < boardSize && board[row * boardSize + c] === color) { h++; c++; }
  if (h >= 3) return true;
  let v = 1;
  let r = row - 1;
  while (r >= 0 && board[r * boardSize + col] === color) { v++; r--; }
  r = row + 1;
  while (r < boardSize && board[r * boardSize + col] === color) { v++; r++; }
  return v >= 3;
}

function shuffleNonNullTiles() {
  const indices = [];
  const colors = [];
  board.forEach((v, i) => {
    if (v !== null) { indices.push(i); colors.push(v); }
  });

  // Fisher-Yates shuffle
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  indices.forEach((idx, i) => { board[idx] = colors[i]; });

  // Break any matches the shuffle accidentally created
  let attempts = 0;
  while (findMatches().length > 0 && attempts < 200) {
    attempts++;
    findMatches().forEach((idx) => {
      let color;
      let tries = 0;
      do {
        color = randomColor();
        tries++;
      } while (tries < 20 && couldCauseMatch(idx, color));
      board[idx] = color;
    });
  }
}

function ensurePlayableBoard() {
  let validMove = findValidMove();
  let shuffleAttempts = 0;

  while (!validMove && shuffleAttempts < 8) {
    shuffleNonNullTiles();
    validMove = findValidMove();
    shuffleAttempts += 1;
  }

  let rebuildAttempts = 0;
  while (!validMove && rebuildAttempts < 8) {
    fillFreshBoard();
    validMove = findValidMove();
    rebuildAttempts += 1;
  }

  return validMove;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function spawnTileShatter(tile, color, hasObstacle) {
  const slot = getTileSlotPosition(tile);
  const size = slot.width;
  const pieceConfigs = [
    { x: 0.18, y: 0.16, size: 0.2, dx: -18, dy: -24, rotate: -28, shape: "tile-shatter-shape-a", delay: 0 },
    { x: 0.44, y: 0.1, size: 0.17, dx: 2, dy: -30, rotate: 22, shape: "tile-shatter-shape-b", delay: 24 },
    { x: 0.66, y: 0.18, size: 0.22, dx: 24, dy: -18, rotate: 34, shape: "tile-shatter-shape-c", delay: 12 },
    { x: 0.14, y: 0.48, size: 0.16, dx: -28, dy: 4, rotate: -18, shape: "tile-shatter-shape-b", delay: 40 },
    { x: 0.4, y: 0.42, size: 0.18, dx: 0, dy: 18, rotate: -10, shape: "tile-shatter-shape-a", delay: 58 },
    { x: 0.68, y: 0.5, size: 0.15, dx: 26, dy: 8, rotate: 18, shape: "tile-shatter-shape-c", delay: 34 },
    { x: 0.52, y: 0.68, size: 0.14, dx: 12, dy: 26, rotate: 28, shape: "tile-shatter-shape-b", delay: 72 }
  ];
  const ringConfigs = [
    { size: 0.34, delay: 10, className: "tile-shatter-ring-1" },
    { size: 0.62, delay: 90, className: "tile-shatter-ring-2" }
  ];

  ringConfigs.forEach(({ size: rs, delay, className }) => {
    const ring = document.createElement("span");
    ring.className = `tile-shatter-ring ${className}`;
    ring.setAttribute("aria-hidden", "true");
    ring.style.left = `${slot.left + size * (0.5 - rs / 2)}px`;
    ring.style.top = `${slot.top + size * (0.5 - rs / 2)}px`;
    ring.style.width = `${size * rs}px`;
    ring.style.height = `${size * rs}px`;
    ring.style.animationDelay = `${delay}ms`;
    boardElement.appendChild(ring);
  });

  pieceConfigs.forEach(({ x, y, size: ps, dx, dy, rotate, shape, delay }) => {
    const piece = document.createElement("span");
    piece.className = `tile-shatter-piece ${shape} color-${color}`;
    piece.setAttribute("aria-hidden", "true");
    if (hasObstacle) piece.classList.add("obstacle");
    piece.style.left = `${slot.left + size * x}px`;
    piece.style.top = `${slot.top + size * y}px`;
    piece.style.width = `${size * ps}px`;
    piece.style.height = `${size * ps}px`;
    piece.style.setProperty("--piece-dx", `${dx}px`);
    piece.style.setProperty("--piece-dy", `${dy}px`);
    piece.style.setProperty("--piece-rotate", `${rotate}deg`);
    piece.style.animationDelay = `${delay}ms`;
    boardElement.appendChild(piece);
  });

  if (hasObstacle) {
    const dustConfigs = [
      { x: 0.18, y: 0.18, size: 0.13, dx: -20, dy: -18, delay: 10 },
      { x: 0.52, y: 0.12, size: 0.12, dx: 8, dy: -24, delay: 26 },
      { x: 0.72, y: 0.36, size: 0.1, dx: 22, dy: -4, delay: 38 },
      { x: 0.3, y: 0.56, size: 0.12, dx: -12, dy: 18, delay: 52 },
      { x: 0.6, y: 0.62, size: 0.11, dx: 14, dy: 20, delay: 68 }
    ];

    dustConfigs.forEach(({ x, y, size: dustSize, dx, dy, delay }) => {
      const dust = document.createElement("span");
      dust.className = "obstacle-break-dust";
      dust.setAttribute("aria-hidden", "true");
      dust.style.left = `${slot.left + size * x}px`;
      dust.style.top = `${slot.top + size * y}px`;
      dust.style.width = `${size * dustSize}px`;
      dust.style.height = `${size * dustSize}px`;
      dust.style.setProperty("--dust-dx", `${dx}px`);
      dust.style.setProperty("--dust-dy", `${dy}px`);
      dust.style.animationDelay = `${delay}ms`;
      boardElement.appendChild(dust);
    });
  }
}

function renderBoard(clearing = []) {
  const scrollPos = getScrollPosition();
  const active = document.activeElement;
  if (active instanceof HTMLElement && boardElement.contains(active)) active.blur();

  boardElement.innerHTML = "";
  const clearingSet = new Set(clearing);
  const hintSet = new Set(hintIndices);

  board.forEach((color, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `tile color-${color}`;
    tile.dataset.index = index;
    tile.setAttribute("aria-label", `Tile ${index + 1}`);

    if (obstacles[index]) tile.classList.add("obstacle");
    if (clearingSet.has(index)) tile.classList.add("clearing");
    if (clearingSet.has(index) && obstacles[index]) tile.classList.add("obstacle-breaking");
    if (hintSet.has(index)) tile.classList.add("tile-hint");

    tile.addEventListener("pointerdown", (event) => handlePointerDown(event, index));
    tile.addEventListener("pointermove", handlePointerMove);
    tile.addEventListener("pointerup", (event) => handlePointerUp(event, index));
    tile.addEventListener("pointercancel", handlePointerCancel);
    boardElement.appendChild(tile);

    if (clearingSet.has(index)) {
      spawnTileShatter(tile, color, obstacles[index]);
    }
  });

  restoreScrollPosition(scrollPos);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHud() {
  scoreElement.textContent = score;
  obstaclesElement.textContent = countRemainingObstacles();
  movesElement.textContent = movesLeft;
}

function updateHighScore() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("match3HighScore", String(highScore));
  }
}

function setStatus(message) {
  statusElement.textContent = message;
}

// ─── Celebration ──────────────────────────────────────────────────────────────
function showCelebration(totalCleared, bonusMoves) {
  if (totalCleared <= 3) return;
  if (celebrationTimeout) window.clearTimeout(celebrationTimeout);
  const tileWord = totalCleared === 1 ? "TILE" : "TILES";
  const moveWord = bonusMoves === 1 ? "MOVE" : "MOVES";
  const bonusText = bonusMoves > 0 ? `<br>YOU EARNED +${bonusMoves} ${moveWord}` : "";
  celebrationTextElement.innerHTML = `<span>GOOD JOB. CLEARED ${totalCleared} ${tileWord}${bonusText}</span>`;
  celebrationElement.classList.add("visible");
  celebrationElement.classList.toggle("strong", totalCleared > 4);
  celebrationTimeout = window.setTimeout(() => {
    celebrationElement.classList.remove("visible", "strong");
  }, totalCleared > 4 ? 2100 : 1700);
}

function animateFlyingBonus(bonusMoves) {
  if (bonusMoves <= 0) return Promise.resolve();
  if (flyingBonusTimeout) window.clearTimeout(flyingBonusTimeout);
  const cr = celebrationElement.getBoundingClientRect();
  const mr = movesPanelElement.getBoundingClientRect();
  const moveWord = bonusMoves === 1 ? "MOVE" : "MOVES";
  flyingBonusElement.textContent = `+${bonusMoves} ${moveWord}`;
  flyingBonusElement.style.setProperty("--start-x", `${cr.left + cr.width / 2}px`);
  flyingBonusElement.style.setProperty("--start-y", `${cr.top + cr.height / 2}px`);
  flyingBonusElement.style.setProperty("--end-x", `${mr.left + mr.width / 2}px`);
  flyingBonusElement.style.setProperty("--end-y", `${mr.top + mr.height / 2}px`);
  flyingBonusElement.classList.remove("visible");
  void flyingBonusElement.offsetWidth;
  flyingBonusElement.classList.add("visible");
  return new Promise((resolve) => {
    flyingBonusTimeout = window.setTimeout(() => {
      flyingBonusElement.classList.remove("visible");
      resolve();
    }, 1550);
  });
}

function getBonusMoves(totalCleared) {
  if (totalCleared >= 9) return 2;
  if (totalCleared >= 4) return 1;
  return 0;
}

// ─── Game-over modal ──────────────────────────────────────────────────────────
function showGameOverModal(title, message, isWin) {
  gameOverTitle.textContent = title;
  const isNewBest = score > 0 && score >= highScore;
  const bestLine = isNewBest
    ? `<strong class="new-best">New best score: ${score}!</strong>`
    : `Best score: ${highScore}`;
  gameOverMessage.innerHTML = `${message}<br><span class="modal-best">${bestLine}</span>`;
  gameOverModal.setAttribute("aria-hidden", "false");
  gameOverModal.classList.add("visible");
  gameOverModal.classList.toggle("modal-win", !!isWin);
  gameOverModal.classList.toggle("modal-lose", !isWin);
}

function hideGameOverModal() {
  gameOverModal.setAttribute("aria-hidden", "true");
  gameOverModal.classList.remove("visible", "modal-win", "modal-lose");
}

// ─── Hint system ──────────────────────────────────────────────────────────────
function clearHint() {
  if (hintTimeout) { window.clearTimeout(hintTimeout); hintTimeout = null; }
  if (hintIndices.length > 0) { hintIndices = []; renderBoard(); }
}

function showHint() {
  if (locked || gameFinished || movesLeft <= 0) return;
  clearHint();
  let move = findValidMove();
  if (!move) {
    playSound("shuffle");
    boardElement.classList.add("board-shuffling");
    shuffleNonNullTiles();
    move = ensurePlayableBoard();
    renderBoard();
    window.setTimeout(() => {
      boardElement.classList.remove("board-shuffling");
    }, 460);
  }

  if (!move) {
    setStatus("I could not find a valid move. Restart the board and try again.");
    return;
  }

  playSound("hint");
  hintIndices = move;
  renderBoard();
  setStatus("Here is a hint!");
  hintTimeout = window.setTimeout(() => {
    hintIndices = [];
    hintTimeout = null;
    renderBoard();
  }, hintDuration);
}

// ─── Cascade clearing ─────────────────────────────────────────────────────────
async function clearMatches() {
  let totalCleared = 0;
  let obstaclesCleared = 0;
  let cascadeLevel = 0;

  while (true) {
    const matches = findMatches();
    if (matches.length === 0) break;
    const matchedObstacleCount = matches.filter((index) => obstacles[index]).length;
    const clearDuration = matchedObstacleCount > 0 ? 620 : 520;

    playSound(cascadeLevel === 0 ? "match" : "cascade", cascadeLevel);
    cascadeLevel++;
    totalCleared += matches.length;

    renderBoard(matches);
    if (cascadeLevel > 1) {
      triggerBoardImpact(cascadeLevel);
    }
    await sleep(clearDuration);

    const clearedSet = new Set(matches);
    const fallData = computeFallData(board, clearedSet);

    matches.forEach((index) => {
      if (obstacles[index]) { obstacles[index] = false; obstaclesCleared++; }
      board[index] = null;
    });

    refillBoard();
    score += matches.length * matchScore;

    // Animate tiles sliding down into their new positions
    await animateBoardFall(fallData);
    updateHud();
    await sleep(60);
  }

  return { totalCleared, obstaclesCleared };
}

// ─── Move handling ────────────────────────────────────────────────────────────
async function tryMove(fromIndex, toIndex) {
  if (locked || gameFinished || movesLeft <= 0 || fromIndex === toIndex || !isAdjacent(fromIndex, toIndex)) {
    return;
  }

  locked = true;
  clearHint();

  playSound("swap");
  await animateSwapMove(fromIndex, toIndex, { continueFromPreview: true });
  swapTiles(fromIndex, toIndex);
  renderBoard();

  const immediateMatches = findMatches();
  if (immediateMatches.length === 0) {
    playSound("noMatch");
    await animateSwapMove(toIndex, fromIndex);
    swapTiles(fromIndex, toIndex);
    renderBoard();
    setStatus("That move did not create a match.");
    locked = false;
    return;
  }

  movesLeft -= 1;
  updateHud();
  const result = await clearMatches();
  const remainingObstacles = countRemainingObstacles();
  const bonusMoves = getBonusMoves(result.totalCleared);

  if (remainingObstacles === 0) {
    // Win — check before bonus animation so the player isn't confused
    gameFinished = true;
    updateHighScore();
    showCelebration(result.totalCleared, 0);
    playSound("win");
    const msg = `You cleared every obstacle with ${movesLeft} move${movesLeft === 1 ? "" : "s"} left! Final score: ${score}.`;
    setStatus(msg);
    showGameOverModal("You Won!", msg, true);
  } else {
    // Award bonus moves before checking for a loss
    showCelebration(result.totalCleared, bonusMoves);
    if (bonusMoves > 0) {
      playSound("bonus");
      await animateFlyingBonus(bonusMoves);
      movesLeft += bonusMoves;
      updateHud();
    }

    if (movesLeft === 0) {
      gameFinished = true;
      updateHighScore();
      playSound("lose");
      const remaining = countRemainingObstacles();
      const msg = `Out of moves. ${remaining} obstacle${remaining === 1 ? "" : "s"} left. Final score: ${score}.`;
      setStatus(msg);
      showGameOverModal("Game Over", msg, false);
    } else {
      // Check whether any valid swap still exists
      const validMove = findValidMove();
      if (!validMove) {
        setStatus("No valid moves — shuffling board...");
        playSound("shuffle");
        boardElement.classList.add("board-shuffling");
        await sleep(460);
        boardElement.classList.remove("board-shuffling");
        shuffleNonNullTiles();
        renderBoard();
        await sleep(180);
        // Safety net: if shuffle still leaves no valid move, reset the board colours
        if (!findValidMove()) {
          fillFreshBoard();
          renderBoard();
        }
        setStatus("Board shuffled. Make a move!");
      } else {
        const obstacleText = result.obstaclesCleared > 0
          ? ` and cleared ${result.obstaclesCleared} obstacle${result.obstaclesCleared === 1 ? "" : "s"}`
          : "";
        const bonusText = bonusMoves > 0
          ? ` and earned ${bonusMoves} bonus move${bonusMoves === 1 ? "" : "s"}`
          : "";
        setStatus(`Nice move. Cleared ${result.totalCleared} tiles${obstacleText}${bonusText}.`);
      }
    }
  }

  locked = false;
}

// ─── Swipe target ─────────────────────────────────────────────────────────────
// threshold defaults to 24 px for a real move; the preview passes 6 for earlier feedback
function findSwipeTarget(startIndex, deltaX, deltaY, threshold = 24) {
  const { row, col } = indexToRowCol(startIndex);
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > threshold && col < boardSize - 1) return startIndex + 1;
    if (deltaX < -threshold && col > 0) return startIndex - 1;
  } else {
    if (deltaY > threshold && row < boardSize - 1) return startIndex + boardSize;
    if (deltaY < -threshold && row > 0) return startIndex - boardSize;
  }
  return null;
}

// ─── Pointer handlers ─────────────────────────────────────────────────────────
function handlePointerDown(event, index) {
  if (locked || gameFinished || movesLeft <= 0) return;
  event.preventDefault();
  event.currentTarget.blur();
  event.currentTarget.setPointerCapture(event.pointerId);
  pointerStart = {
    index,
    element: event.currentTarget,
    x: event.clientX,
    y: event.clientY,
    moved: false
  };
}

function handlePointerMove(event) {
  if (!pointerStart) return;
  event.preventDefault();
  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  updateTilePreview(pointerStart.element, deltaX, deltaY);
  if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) pointerStart.moved = true;
}

function handlePointerUp(event, index) {
  if (!pointerStart || pointerStart.index !== index) return;
  event.preventDefault();
  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  const moved = pointerStart.moved;
  pointerStart = null;

  if (!moved) {
    stopTilePreview();
    setStatus("Swipe a tile one space to slide it.");
    return;
  }

  const target = findSwipeTarget(index, deltaX, deltaY);
  if (target !== null) {
    tryMove(index, target);
  } else {
    stopTilePreview();
    setStatus("Swipe farther in one direction to make a move.");
  }
}

function handlePointerCancel() {
  stopTilePreview();
  pointerStart = null;
}

// ─── Board initialisation ─────────────────────────────────────────────────────
// Places tiles one at a time, rejecting colours that would immediately form
// a 3-in-a-row horizontally or vertically — no correction loop needed.
function wouldCreateInitialMatch(index, color) {
  const { row, col } = indexToRowCol(index);
  if (col >= 2 && board[index - 1] === color && board[index - 2] === color) return true;
  if (row >= 2 && board[index - boardSize] === color && board[index - boardSize * 2] === color) return true;
  return false;
}

function fillFreshBoard() {
  board = Array(boardSize * boardSize).fill(null);
  for (let i = 0; i < board.length; i++) {
    let color = randomColor();
    let tries = 0;
    while (tries < 12 && wouldCreateInitialMatch(i, color)) {
      color = randomColor();
      tries++;
    }
    board[i] = color;
  }
}

// Places obstacles with at least one empty cell between each pair so they
// spread across the board rather than clustering.
function placeObstacles() {
  obstacles = Array(boardSize * boardSize).fill(false);
  let placed = 0;
  let attempts = 0;

  while (placed < startingObstacles && attempts < 2000) {
    attempts++;
    const index = Math.floor(Math.random() * (boardSize * boardSize));
    if (obstacles[index]) continue;

    const { row, col } = indexToRowCol(index);
    let tooClose = false;
    outer: for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < boardSize && c >= 0 && c < boardSize && obstacles[r * boardSize + c]) {
          tooClose = true;
          break outer;
        }
      }
    }
    if (tooClose) continue;

    obstacles[index] = true;
    placed++;
  }

  // Fallback: if spacing constraint made it impossible, place remaining freely
  while (placed < startingObstacles) {
    const index = Math.floor(Math.random() * (boardSize * boardSize));
    if (!obstacles[index]) { obstacles[index] = true; placed++; }
  }
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────
function startGame() {
  cleanupActiveSwap();
  hideGameOverModal();
  clearHint();
  clearBoardImpact();
  unlockAudioFromGesture();
  score = 0;
  movesLeft = startingMoves;
  locked = false;
  gameFinished = false;
  pointerStart = null;
  if (celebrationTimeout) window.clearTimeout(celebrationTimeout);
  if (flyingBonusTimeout) window.clearTimeout(flyingBonusTimeout);
  celebrationElement.classList.remove("visible", "strong");
  celebrationTextElement.textContent = "";
  flyingBonusElement.classList.remove("visible");
  flyingBonusElement.textContent = "";
  fillFreshBoard();
  placeObstacles();
  ensurePlayableBoard();
  renderBoard();
  updateHud();
  setStatus("Clear all cracked cells before you run out of moves.");
}

// ─── Mute toggle ──────────────────────────────────────────────────────────────
function toggleMute() {
  soundMuted = !soundMuted;
  muteButton.textContent = soundMuted ? "Sound: Off" : "Sound: On";
  muteButton.setAttribute("aria-pressed", String(soundMuted));
  if (!soundMuted) {
    unlockAudioFromGesture();
    playSound("hint");
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
window.addEventListener("pointerdown", unlockAudioFromGesture, { passive: true });
window.addEventListener("keydown", unlockAudioFromGesture, { passive: true });
restartButton.addEventListener("click", startGame);
menuButton.addEventListener("click", returnToMenu);
startButton.addEventListener("click", openGameFromMenu);
openHowToPlayButton.addEventListener("click", () => showMenuView("menu-how-to-play"));
howToPlayBackButton.addEventListener("click", () => showMenuView("menu-home"));
openCreditsButton.addEventListener("click", () => showMenuView("menu-credits"));
creditsBackButton.addEventListener("click", () => showMenuView("menu-home"));
hintButton.addEventListener("click", showHint);
muteButton.addEventListener("click", toggleMute);
gameOverPlayAgain.addEventListener("click", startGame);
gameOverMenuBtn.addEventListener("click", returnToMenu);

showMenuView("menu-home");
setStatus("Press Start Game to begin.");
