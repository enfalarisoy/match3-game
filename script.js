const boardSize = 8;
const colorCount = 6;
const startingMoves = 24;
const matchScore = 10;
const startingObstacles = 12;

const boardElement = document.getElementById("board");
const celebrationElement = document.getElementById("celebration");
const celebrationTextElement = document.getElementById("celebration-text");
const flyingBonusElement = document.getElementById("flying-bonus");
const scoreElement = document.getElementById("score");
const obstaclesElement = document.getElementById("obstacles");
const movesElement = document.getElementById("moves");
const movesPanelElement = document.getElementById("moves-panel");
const statusElement = document.getElementById("status");
const restartButton = document.getElementById("restart");

let board = [];
let obstacles = [];
let score = 0;
let movesLeft = startingMoves;
let locked = false;
let gameFinished = false;
let pointerStart = null;
let celebrationTimeout = null;
let flyingBonusTimeout = null;

function randomColor() {
  return Math.floor(Math.random() * colorCount);
}

function indexToRowCol(index) {
  return {
    row: Math.floor(index / boardSize),
    col: index % boardSize
  };
}

function isAdjacent(a, b) {
  const first = indexToRowCol(a);
  const second = indexToRowCol(b);
  const rowDistance = Math.abs(first.row - second.row);
  const colDistance = Math.abs(first.col - second.col);
  return rowDistance + colDistance === 1;
}

function swapTiles(a, b) {
  [board[a], board[b]] = [board[b], board[a]];
}

function countRemainingObstacles() {
  return obstacles.filter(Boolean).length;
}

function getOrthogonalNeighbors(index) {
  const { row, col } = indexToRowCol(index);
  const neighbors = [];

  if (row > 0) {
    neighbors.push(index - boardSize);
  }
  if (row < boardSize - 1) {
    neighbors.push(index + boardSize);
  }
  if (col > 0) {
    neighbors.push(index - 1);
  }
  if (col < boardSize - 1) {
    neighbors.push(index + 1);
  }

  return neighbors;
}

function expandAdjacentColorBlast(matched) {
  const expanded = new Set(matched);
  const queue = [...matched];

  while (queue.length > 0) {
    const current = queue.shift();
    const color = board[current];

    if (color === null) {
      continue;
    }

    getOrthogonalNeighbors(current).forEach((neighbor) => {
      if (expanded.has(neighbor) || board[neighbor] !== color) {
        return;
      }

      expanded.add(neighbor);
      queue.push(neighbor);
    });
  }

  return [...expanded];
}

function findMatches() {
  const matched = new Set();

  for (let row = 0; row < boardSize; row += 1) {
    let streak = 1;
    for (let col = 1; col <= boardSize; col += 1) {
      const currentIndex = row * boardSize + col;
      const prevIndex = row * boardSize + col - 1;
      const currentValue = col < boardSize ? board[currentIndex] : null;
      const prevValue = board[prevIndex];
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
      const currentValue = row < boardSize ? board[currentIndex] : null;
      const prevValue = board[prevIndex];
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
      const color = board[topLeft];

      if (
        color !== null &&
        color === board[topRight] &&
        color === board[bottomLeft] &&
        color === board[bottomRight]
      ) {
        matched.add(topLeft);
        matched.add(topRight);
        matched.add(bottomLeft);
        matched.add(bottomRight);
      }
    }
  }

  return expandAdjacentColorBlast([...matched]);
}

function refillBoard() {
  for (let col = 0; col < boardSize; col += 1) {
    const values = [];
    for (let row = boardSize - 1; row >= 0; row -= 1) {
      const index = row * boardSize + col;
      if (board[index] !== null) {
        values.push(board[index]);
      }
    }

    while (values.length < boardSize) {
      values.push(randomColor());
    }

    for (let row = boardSize - 1, pointer = 0; row >= 0; row -= 1, pointer += 1) {
      board[row * boardSize + col] = values[pointer];
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function renderBoard(clearing = []) {
  boardElement.innerHTML = "";
  const clearingSet = new Set(clearing);

  board.forEach((color, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `tile color-${color}`;
    tile.dataset.index = index;
    tile.setAttribute("aria-label", `Tile ${index + 1}`);

    if (obstacles[index]) {
      tile.classList.add("obstacle");
    }

    if (clearingSet.has(index)) {
      tile.classList.add("clearing");
    }

    tile.addEventListener("pointerdown", (event) => handlePointerDown(event, index));
    tile.addEventListener("pointermove", handlePointerMove);
    tile.addEventListener("pointerup", (event) => handlePointerUp(event, index));
    tile.addEventListener("pointercancel", handlePointerCancel);
    boardElement.appendChild(tile);
  });
}

function updateHud() {
  scoreElement.textContent = score;
  obstaclesElement.textContent = countRemainingObstacles();
  movesElement.textContent = movesLeft;
}

function setStatus(message) {
  statusElement.textContent = message;
}

function showCelebration(totalCleared, bonusMoves) {
  if (totalCleared <= 3) {
    return;
  }

  if (celebrationTimeout) {
    window.clearTimeout(celebrationTimeout);
  }

  const tileWord = totalCleared === 1 ? "TILE" : "TILES";
  const moveWord = bonusMoves === 1 ? "MOVE" : "MOVES";
  const bonusText = bonusMoves > 0 ? `<br>YOU EARNED +${bonusMoves} ${moveWord}` : "";
  celebrationTextElement.innerHTML = `<span>GOOD JOB. CLEARED ${totalCleared} ${tileWord}${bonusText}</span>`;
  celebrationElement.classList.add("visible");
  celebrationElement.classList.toggle("strong", totalCleared > 4);

  celebrationTimeout = window.setTimeout(() => {
    celebrationElement.classList.remove("visible");
    celebrationElement.classList.remove("strong");
  }, totalCleared > 4 ? 2100 : 1700);
}

function animateFlyingBonus(bonusMoves) {
  if (bonusMoves <= 0) {
    return Promise.resolve();
  }

  if (flyingBonusTimeout) {
    window.clearTimeout(flyingBonusTimeout);
  }

  const celebrationRect = celebrationElement.getBoundingClientRect();
  const movesRect = movesPanelElement.getBoundingClientRect();
  const startX = celebrationRect.left + celebrationRect.width / 2;
  const startY = celebrationRect.top + celebrationRect.height / 2;
  const endX = movesRect.left + movesRect.width / 2;
  const endY = movesRect.top + movesRect.height / 2;
  const moveWord = bonusMoves === 1 ? "MOVE" : "MOVES";

  flyingBonusElement.textContent = `+${bonusMoves} ${moveWord}`;
  flyingBonusElement.style.setProperty("--start-x", `${startX}px`);
  flyingBonusElement.style.setProperty("--start-y", `${startY}px`);
  flyingBonusElement.style.setProperty("--end-x", `${endX}px`);
  flyingBonusElement.style.setProperty("--end-y", `${endY}px`);
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
  if (totalCleared >= 9) {
    return 2;
  }
  if (totalCleared >= 4) {
    return 1;
  }
  return 0;
}

async function clearMatches() {
  let totalCleared = 0;
  let obstaclesCleared = 0;

  while (true) {
    const matches = findMatches();
    if (matches.length === 0) {
      break;
    }

    totalCleared += matches.length;
    renderBoard(matches);
    await sleep(180);

    matches.forEach((index) => {
      if (obstacles[index]) {
        obstacles[index] = false;
        obstaclesCleared += 1;
      }
      board[index] = null;
    });
    refillBoard();
    score += matches.length * matchScore;
    renderBoard();
    updateHud();
    await sleep(120);
  }

  return {
    totalCleared,
    obstaclesCleared
  };
}

async function tryMove(fromIndex, toIndex) {
  if (locked || gameFinished || movesLeft <= 0 || fromIndex === toIndex || !isAdjacent(fromIndex, toIndex)) {
    return;
  }

  locked = true;
  swapTiles(fromIndex, toIndex);
  renderBoard();

  const immediateMatches = findMatches();
  if (immediateMatches.length === 0) {
    await sleep(120);
    swapTiles(fromIndex, toIndex);
    renderBoard();
    setStatus("That move did not create a match.");
    locked = false;
    return;
  }

  movesLeft -= 1;
  updateHud();
  const result = await clearMatches();
  const bonusMoves = getBonusMoves(result.totalCleared);
  showCelebration(result.totalCleared, bonusMoves);
  if (bonusMoves > 0) {
    await animateFlyingBonus(bonusMoves);
    movesLeft += bonusMoves;
    updateHud();
  }
  const remainingObstacles = countRemainingObstacles();

  if (remainingObstacles === 0) {
    gameFinished = true;
    const bonusText = bonusMoves > 0 ? ` and earned ${bonusMoves} bonus move${bonusMoves === 1 ? "" : "s"}` : "";
    setStatus(`You cleared every obstacle with ${movesLeft} moves left${bonusText}. Final score: ${score}.`);
  } else if (movesLeft === 0) {
    gameFinished = true;
    setStatus(`Out of moves. ${remainingObstacles} obstacles left. Final score: ${score}.`);
  } else {
    const obstacleText = result.obstaclesCleared > 0
      ? ` and cleaned ${result.obstaclesCleared} obstacle${result.obstaclesCleared === 1 ? "" : "s"}`
      : "";
    const bonusText = bonusMoves > 0
      ? ` and earned ${bonusMoves} bonus move${bonusMoves === 1 ? "" : "s"}`
      : "";
    setStatus(`Nice move. Cleared ${result.totalCleared} tiles${obstacleText}${bonusText}.`);
  }

  locked = false;
}

function findSwipeTarget(startIndex, deltaX, deltaY) {
  const { row, col } = indexToRowCol(startIndex);
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > 24 && col < boardSize - 1) {
      return startIndex + 1;
    }
    if (deltaX < -24 && col > 0) {
      return startIndex - 1;
    }
  } else {
    if (deltaY > 24 && row < boardSize - 1) {
      return startIndex + boardSize;
    }
    if (deltaY < -24 && row > 0) {
      return startIndex - boardSize;
    }
  }
  return null;
}

function handlePointerDown(event, index) {
  if (locked || gameFinished || movesLeft <= 0) {
    return;
  }

  event.currentTarget.setPointerCapture(event.pointerId);
  pointerStart = {
    index,
    x: event.clientX,
    y: event.clientY,
    moved: false
  };
}

function handlePointerMove(event) {
  if (!pointerStart) {
    return;
  }

  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
    pointerStart.moved = true;
  }
}

function handlePointerUp(event, index) {
  if (!pointerStart || pointerStart.index !== index) {
    return;
  }

  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  const moved = pointerStart.moved;
  pointerStart = null;

  if (!moved) {
    setStatus("Swipe a tile one space to slide it.");
    return;
  }

  const target = findSwipeTarget(index, deltaX, deltaY);
  if (target !== null) {
    tryMove(index, target);
  } else {
    setStatus("Swipe farther in one direction to make a move.");
  }
}

function handlePointerCancel() {
  pointerStart = null;
}

function fillFreshBoard() {
  board = Array.from({ length: boardSize * boardSize }, () => randomColor());
  while (findMatches().length > 0) {
    findMatches().forEach((index) => {
      board[index] = randomColor();
    });
  }
}

function placeObstacles() {
  obstacles = Array.from({ length: boardSize * boardSize }, () => false);
  let placed = 0;

  while (placed < startingObstacles) {
    const index = Math.floor(Math.random() * obstacles.length);
    if (obstacles[index]) {
      continue;
    }
    obstacles[index] = true;
    placed += 1;
  }
}

function startGame() {
  score = 0;
  movesLeft = startingMoves;
  locked = false;
  gameFinished = false;
  pointerStart = null;
  if (celebrationTimeout) {
    window.clearTimeout(celebrationTimeout);
  }
  if (flyingBonusTimeout) {
    window.clearTimeout(flyingBonusTimeout);
  }
  celebrationElement.classList.remove("visible");
  celebrationElement.classList.remove("strong");
  celebrationTextElement.textContent = "";
  flyingBonusElement.classList.remove("visible");
  flyingBonusElement.textContent = "";
  fillFreshBoard();
  placeObstacles();
  renderBoard();
  updateHud();
  setStatus("Clear all cracked cells before you run out of moves.");
}

restartButton.addEventListener("click", startGame);

startGame();
