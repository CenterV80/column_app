"use strict";

/* ---------------------------------------------------------------------
 * Math expression parser: tokenizer -> shunting-yard -> RPN evaluator
 * Supports: + - * / ^ %  unary +/-  ( )  ,
 * Functions: sin cos tan asin acos atan sinh cosh tanh sqrt abs
 *            log ln exp floor ceil round sign min max
 * Constants: pi e
 * Variable: x
 * Implicit multiplication: 2x, 2(x+1), x(x+1), (x+1)(x-1), (x+1)2
 * ------------------------------------------------------------------- */

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "sqrt", "abs", "log", "ln",
  "exp", "floor", "ceil", "round", "sign", "min", "max",
]);
const CONSTANTS = { pi: Math.PI, e: Math.E };

class ParseError extends Error {}

function tokenize(input) {
  const src = input.replace(/\s+/g, "");
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numStr = src.slice(i, j);
      if (!/^\d*\.?\d+$/.test(numStr) && !/^\d+\.?\d*$/.test(numStr)) {
        throw new ParseError("不正な数値です");
      }
      tokens.push({ type: "NUM", value: parseFloat(numStr) });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      let name = src.slice(i, j);
      // Followed immediately by '(' and a known function name -> function call
      if (FUNCTIONS.has(name) && src[j] === "(") {
        tokens.push({ type: "FUNC", value: name });
        i = j;
        continue;
      }
      if (CONSTANTS.hasOwnProperty(name)) {
        tokens.push({ type: "CONST", value: name });
        i = j;
        continue;
      }
      if (name === "x") {
        tokens.push({ type: "VAR" });
        i = j;
        continue;
      }
      // Try to decompose into known pieces (constants / function calls / x's)
      let k = 0;
      let consumed = false;
      while (k < name.length) {
        let matched = false;
        for (const constName of Object.keys(CONSTANTS)) {
          if (name.startsWith(constName, k)) {
            tokens.push({ type: "CONST", value: constName });
            k += constName.length;
            matched = true;
            consumed = true;
            break;
          }
        }
        if (matched) continue;
        if (name[k] === "x") {
          tokens.push({ type: "VAR" });
          k += 1;
          consumed = true;
          continue;
        }
        throw new ParseError(`不明な識別子です: "${name}"`);
      }
      if (!consumed) throw new ParseError(`不明な識別子です: "${name}"`);
      i = j;
    } else if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^" || c === "%") {
      tokens.push({ type: "OP", value: c });
      i++;
    } else if (c === "(") {
      tokens.push({ type: "LPAREN" });
      i++;
    } else if (c === ")") {
      tokens.push({ type: "RPAREN" });
      i++;
    } else if (c === ",") {
      tokens.push({ type: "COMMA" });
      i++;
    } else if (c === "=") {
      // allow a single top-level '=' as in "y=..." but we already strip the
      // leading "y=" before tokenizing, so a stray '=' is an error.
      throw new ParseError("この電卓は y = f(x) の形式のみ対応しています");
    } else {
      throw new ParseError(`使用できない文字です: "${c}"`);
    }
  }
  return tokens;
}

function isValueEnd(tok) {
  return tok && (tok.type === "NUM" || tok.type === "CONST" || tok.type === "VAR" || tok.type === "RPAREN");
}
function isValueStart(tok) {
  return tok && (tok.type === "NUM" || tok.type === "CONST" || tok.type === "VAR" || tok.type === "FUNC" || tok.type === "LPAREN");
}

function insertImplicitMultiplication(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (out.length > 0 && isValueEnd(out[out.length - 1]) && isValueStart(tok)) {
      out.push({ type: "OP", value: "*" });
    }
    out.push(tok);
  }
  return out;
}

const PRECEDENCE = { u: 4, "^": 5, "*": 3, "/": 3, "%": 3, "+": 2, "-": 2 };
const RIGHT_ASSOC = new Set(["^", "u"]);

function toRPN(tokens) {
  const output = [];
  const stack = [];
  let prevType = null; // to detect unary vs binary

  const peekIsOp = () => stack.length && stack[stack.length - 1].type === "OP";

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === "NUM" || tok.type === "CONST" || tok.type === "VAR") {
      output.push(tok);
    } else if (tok.type === "FUNC") {
      stack.push(tok);
    } else if (tok.type === "COMMA") {
      while (stack.length && stack[stack.length - 1].type !== "LPAREN") {
        output.push(stack.pop());
      }
      if (!stack.length) throw new ParseError("カンマの位置が不正です");
    } else if (tok.type === "OP") {
      const isUnary =
        (tok.value === "-" || tok.value === "+") &&
        (prevType === null || prevType === "OP" || prevType === "LPAREN" || prevType === "COMMA" || prevType === "u");
      if (isUnary) {
        // Prefix operator: it has no left operand yet, so it must not pop
        // anything already on the stack -- it simply waits for its operand.
        stack.push({ type: "OP", value: tok.value, isUnary: true });
        prevType = "u";
        continue;
      }
      const prec = PRECEDENCE[tok.value];
      while (
        peekIsOp() &&
        PRECEDENCE[stack[stack.length - 1].isUnary ? "u" : stack[stack.length - 1].value] >= prec &&
        !(RIGHT_ASSOC.has(tok.value) && PRECEDENCE[stack[stack.length - 1].isUnary ? "u" : stack[stack.length - 1].value] === prec)
      ) {
        output.push(stack.pop());
      }
      stack.push({ type: "OP", value: tok.value, isUnary: false });
      prevType = "OP";
      continue;
    } else if (tok.type === "LPAREN") {
      stack.push(tok);
    } else if (tok.type === "RPAREN") {
      let found = false;
      while (stack.length) {
        const top = stack.pop();
        if (top.type === "LPAREN") {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) throw new ParseError("かっこが正しく閉じられていません");
      if (stack.length && stack[stack.length - 1].type === "FUNC") {
        output.push(stack.pop());
      }
    }
    prevType = tok.type;
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.type === "LPAREN") throw new ParseError("かっこが正しく閉じられていません");
    output.push(top);
  }
  return output;
}

function compile(exprText) {
  let text = exprText.trim();
  if (text === "") throw new ParseError("式を入力してください");
  const eqMatch = text.match(/^[a-zA-Z]\s*=\s*(.*)$/);
  if (eqMatch) {
    text = eqMatch[1];
    if (text.trim() === "") throw new ParseError("式を入力してください");
  }
  const tokens = insertImplicitMultiplication(tokenize(text));
  const rpn = toRPN(tokens);
  if (rpn.length === 0) throw new ParseError("式を入力してください");
  return rpn;
}

function evalRPN(rpn, x) {
  const stack = [];
  for (const tok of rpn) {
    if (tok.type === "NUM") {
      stack.push(tok.value);
    } else if (tok.type === "VAR") {
      stack.push(x);
    } else if (tok.type === "CONST") {
      stack.push(CONSTANTS[tok.value]);
    } else if (tok.type === "OP") {
      if (tok.isUnary) {
        const a = stack.pop();
        stack.push(tok.value === "-" ? -a : a);
      } else {
        const b = stack.pop();
        const a = stack.pop();
        switch (tok.value) {
          case "+": stack.push(a + b); break;
          case "-": stack.push(a - b); break;
          case "*": stack.push(a * b); break;
          case "/": stack.push(a / b); break;
          case "%": stack.push(a % b); break;
          case "^": stack.push(Math.pow(a, b)); break;
          default: throw new ParseError("不明な演算子です");
        }
      }
    } else if (tok.type === "FUNC") {
      const nArgs = tok.value === "min" || tok.value === "max" ? 2 : 1;
      const args = [];
      for (let i = 0; i < nArgs; i++) args.unshift(stack.pop());
      switch (tok.value) {
        case "sin": stack.push(Math.sin(args[0])); break;
        case "cos": stack.push(Math.cos(args[0])); break;
        case "tan": stack.push(Math.tan(args[0])); break;
        case "asin": stack.push(Math.asin(args[0])); break;
        case "acos": stack.push(Math.acos(args[0])); break;
        case "atan": stack.push(Math.atan(args[0])); break;
        case "sinh": stack.push(Math.sinh(args[0])); break;
        case "cosh": stack.push(Math.cosh(args[0])); break;
        case "tanh": stack.push(Math.tanh(args[0])); break;
        case "sqrt": stack.push(Math.sqrt(args[0])); break;
        case "abs": stack.push(Math.abs(args[0])); break;
        case "log": stack.push(Math.log10(args[0])); break;
        case "ln": stack.push(Math.log(args[0])); break;
        case "exp": stack.push(Math.exp(args[0])); break;
        case "floor": stack.push(Math.floor(args[0])); break;
        case "ceil": stack.push(Math.ceil(args[0])); break;
        case "round": stack.push(Math.round(args[0])); break;
        case "sign": stack.push(Math.sign(args[0])); break;
        case "min": stack.push(Math.min(args[0], args[1])); break;
        case "max": stack.push(Math.max(args[0], args[1])); break;
        default: throw new ParseError(`不明な関数です: ${tok.value}`);
      }
    }
  }
  if (stack.length !== 1) throw new ParseError("式が不正です");
  return stack[0];
}

/* ---------------------------------------------------------------------
 * Graph view: canvas rendering, pan/zoom, grid
 * ------------------------------------------------------------------- */

const PALETTE = ["#2d70b3", "#c74440", "#388c46", "#6042a6", "#fa7e19", "#000000", "#8c1e93"];

class GraphView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cx = 0; // world x at screen center
    this.cy = 0; // world y at screen center
    this.scale = 50; // pixels per unit
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;

    this._resize();
    window.addEventListener("resize", () => this._resize());

    canvas.addEventListener("mousedown", (e) => this._onPointerDown(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => this._onPointerMove(e.clientX, e.clientY));
    window.addEventListener("mouseup", () => this._onPointerUp());
    canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

    canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) this._onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2) this._onPinchStart(e.touches);
    }, { passive: true });
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2) this._onPinchMove(e.touches);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchend", () => this._onPointerUp());

    canvas.addEventListener("mousemove", (e) => this._updateReadout(e.clientX, e.clientY));
    canvas.addEventListener("mouseleave", () => {
      const el = document.getElementById("coord-readout");
      if (el) el.textContent = "";
    });

    this._dragging = false;
    this._pinch = null;
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  screenToWorld(px, py) {
    return {
      x: this.cx + (px - this.width / 2) / this.scale,
      y: this.cy - (py - this.height / 2) / this.scale,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: this.width / 2 + (wx - this.cx) * this.scale,
      y: this.height / 2 - (wy - this.cy) * this.scale,
    };
  }

  _onPointerDown(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this._dragging = true;
    this._dragStart = { x: clientX - rect.left, y: clientY - rect.top };
    this._dragStartCenter = { cx: this.cx, cy: this.cy };
  }

  _onPointerMove(clientX, clientY) {
    if (!this._dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const dx = px - this._dragStart.x;
    const dy = py - this._dragStart.y;
    this.cx = this._dragStartCenter.cx - dx / this.scale;
    this.cy = this._dragStartCenter.cy + dy / this.scale;
    this.render();
  }

  _onPointerUp() {
    this._dragging = false;
    this._pinch = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const before = this.screenToWorld(px, py);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoomBy(factor);
    const after = this.screenToWorld(px, py);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.render();
  }

  _onPinchStart(touches) {
    const dist = Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
    this._pinch = { dist, scale: this.scale };
    this._dragging = false;
  }

  _onPinchMove(touches) {
    if (!this._pinch) return this._onPinchStart(touches);
    const dist = Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
    const factor = dist / this._pinch.dist;
    this.scale = this._pinch.scale * factor;
    this.render();
  }

  zoomBy(factor) {
    this.scale *= factor;
    this.scale = Math.max(0.5, Math.min(this.scale, 200000));
  }

  zoomAtCenter(factor) {
    this.zoomBy(factor);
    this.render();
  }

  resetView() {
    this.cx = 0;
    this.cy = 0;
    this.scale = 50;
    this.render();
  }

  _updateReadout(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px > this.width || py > this.height) return;
    const w = this.screenToWorld(px, py);
    const el = document.getElementById("coord-readout");
    if (el) el.textContent = `(${w.x.toFixed(3)}, ${w.y.toFixed(3)})`;
  }

  _niceStep(rawStep) {
    const exp = Math.floor(Math.log10(rawStep));
    const base = Math.pow(10, exp);
    const frac = rawStep / base;
    let niceFrac;
    if (frac < 1.5) niceFrac = 1;
    else if (frac < 3.5) niceFrac = 2;
    else if (frac < 7.5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * base;
  }

  render(expressions) {
    this._lastExpressions = expressions || this._lastExpressions || [];
    const { ctx, width, height, scale } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const targetPx = 70;
    const step = this._niceStep(targetPx / scale);
    const xMin = this.cx - width / 2 / scale;
    const xMax = this.cx + width / 2 / scale;
    const yMin = this.cy - height / 2 / scale;
    const yMax = this.cy + height / 2 / scale;

    // Minor grid lines
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    let startX = Math.floor(xMin / step) * step;
    for (let v = startX; v <= xMax; v += step) {
      const sx = this.worldToScreen(v, 0).x;
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, height);
    }
    let startY = Math.floor(yMin / step) * step;
    for (let v = startY; v <= yMax; v += step) {
      const sy = this.worldToScreen(0, v).y;
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(width, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#888";
    ctx.font = "11px sans-serif";
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    for (let v = startX; v <= xMax; v += step) {
      if (Math.abs(v) < step / 1000) continue;
      const sx = this.worldToScreen(v, 0).x;
      let sy = this.worldToScreen(0, 0).y;
      sy = Math.min(Math.max(sy, 12), height - 4);
      ctx.fillText(v.toFixed(decimals), sx + 3, sy + 12);
    }
    for (let v = startY; v <= yMax; v += step) {
      if (Math.abs(v) < step / 1000) continue;
      const sy = this.worldToScreen(0, v).y;
      let sx = this.worldToScreen(0, 0).x;
      sx = Math.min(Math.max(sx, 2), width - 28);
      ctx.fillText(v.toFixed(decimals), sx + 3, sy - 3);
    }

    // Axes
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const originScreen = this.worldToScreen(0, 0);
    const ox = Math.min(Math.max(originScreen.x, 0), width);
    const oy = Math.min(Math.max(originScreen.y, 0), height);
    ctx.moveTo(ox + 0.5, 0);
    ctx.lineTo(ox + 0.5, height);
    ctx.moveTo(0, oy + 0.5);
    ctx.lineTo(width, oy + 0.5);
    ctx.stroke();

    // Function curves
    for (const expr of this._lastExpressions) {
      if (!expr.visible || !expr.rpn) continue;
      ctx.strokeStyle = expr.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let prevY = null;
      let penDown = false;
      const maxJump = height * 3; // heuristic discontinuity threshold in px
      for (let px = 0; px <= width; px++) {
        const wx = this.cx + (px - width / 2) / scale;
        let wy;
        try {
          wy = evalRPN(expr.rpn, wx);
        } catch (err) {
          wy = NaN;
        }
        if (!isFinite(wy)) {
          penDown = false;
          prevY = null;
          continue;
        }
        const sy = height / 2 - (wy - this.cy) * scale;
        if (penDown && prevY !== null && Math.abs(sy - prevY) > maxJump) {
          ctx.moveTo(px, sy);
        } else if (!penDown) {
          ctx.moveTo(px, sy);
        } else {
          ctx.lineTo(px, sy);
        }
        penDown = true;
        prevY = sy;
      }
      ctx.stroke();
    }
  }
}

/* ---------------------------------------------------------------------
 * Expression list UI
 * ------------------------------------------------------------------- */

class ExpressionManager {
  constructor(listEl, graphView) {
    this.listEl = listEl;
    this.graphView = graphView;
    this.expressions = [];
    this.nextId = 1;
    this.colorIndex = 0;
  }

  addExpression(initialText = "") {
    const expr = {
      id: this.nextId++,
      text: initialText,
      color: PALETTE[this.colorIndex % PALETTE.length],
      visible: true,
      rpn: null,
      error: null,
    };
    this.colorIndex++;
    this.expressions.push(expr);
    if (initialText) this._compile(expr);
    this._renderList();
    this._focusExpr(expr.id);
    this._rerenderGraph();
    return expr;
  }

  removeExpression(id) {
    this.expressions = this.expressions.filter((e) => e.id !== id);
    this._renderList();
    this._rerenderGraph();
  }

  _compile(expr) {
    if (expr.text.trim() === "") {
      expr.rpn = null;
      expr.error = null;
      return;
    }
    try {
      expr.rpn = compile(expr.text);
      expr.error = null;
    } catch (err) {
      expr.rpn = null;
      expr.error = err.message || "式が正しくありません";
    }
  }

  _focusExpr(id) {
    requestAnimationFrame(() => {
      const input = this.listEl.querySelector(`[data-id="${id}"] .expr-input`);
      if (input) input.focus();
    });
  }

  _rerenderGraph() {
    this.graphView.render(this.expressions);
  }

  _renderList() {
    this.listEl.innerHTML = "";
    this.expressions.forEach((expr, idx) => {
      const row = document.createElement("div");
      row.className = "expr-row" + (expr.visible ? "" : " disabled");
      row.dataset.id = expr.id;

      const indexLabel = document.createElement("div");
      indexLabel.className = "expr-index";
      indexLabel.textContent = String(idx + 1);
      row.appendChild(indexLabel);

      const colorBtn = document.createElement("button");
      colorBtn.className = "expr-color";
      colorBtn.style.background = expr.color;
      colorBtn.title = "色を変更";
      colorBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggleColorPicker(colorBtn, expr);
      });
      row.appendChild(colorBtn);

      const input = document.createElement("input");
      input.className = "expr-input" + (expr.error ? " error" : "");
      input.type = "text";
      input.placeholder = idx === 0 ? "例: sin(x)" : "y = f(x)";
      input.value = expr.text;
      input.spellcheck = false;
      input.addEventListener("input", () => {
        expr.text = input.value;
        this._compile(expr);
        input.classList.toggle("error", !!expr.error);
        this._showError(row, expr);
        this._rerenderGraph();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const isLast = idx === this.expressions.length - 1;
          if (isLast) this.addExpression("");
          else {
            const next = this.expressions[idx + 1];
            this._focusExpr(next.id);
          }
        }
      });
      row.appendChild(input);

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "expr-toggle";
      toggleBtn.title = expr.visible ? "非表示にする" : "表示する";
      toggleBtn.textContent = expr.visible ? "●" : "○";
      toggleBtn.addEventListener("click", () => {
        expr.visible = !expr.visible;
        this._renderList();
        this._rerenderGraph();
      });
      row.appendChild(toggleBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "expr-delete";
      deleteBtn.title = "削除";
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", () => this.removeExpression(expr.id));
      row.appendChild(deleteBtn);

      this.listEl.appendChild(row);
      this._showError(row, expr);
    });
  }

  _showError(row, expr) {
    let msg = row.parentElement === this.listEl ? row.nextElementSibling : null;
    const existing = row._errEl;
    if (existing) existing.remove();
    if (expr.error && expr.text.trim() !== "") {
      const div = document.createElement("div");
      div.className = "expr-error-msg";
      div.textContent = expr.error;
      row.insertAdjacentElement("afterend", div);
      row._errEl = div;
    } else {
      row._errEl = null;
    }
  }

  _toggleColorPicker(anchorBtn, expr) {
    document.querySelectorAll(".expr-color-picker").forEach((el) => el.remove());
    const picker = document.createElement("div");
    picker.className = "expr-color-picker open";
    PALETTE.forEach((color) => {
      const sw = document.createElement("div");
      sw.className = "expr-color-swatch";
      sw.style.background = color;
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        expr.color = color;
        anchorBtn.style.background = color;
        picker.remove();
        this._rerenderGraph();
      });
      picker.appendChild(sw);
    });
    document.body.appendChild(picker);
    const rect = anchorBtn.getBoundingClientRect();
    picker.style.left = rect.left + "px";
    picker.style.top = rect.bottom + 4 + "px";

    const closeOnOutsideClick = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener("click", closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
  }
}

/* ---------------------------------------------------------------------
 * Bootstrap
 * ------------------------------------------------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("graph");
  const graphView = new GraphView(canvas);
  const manager = new ExpressionManager(document.getElementById("expr-list"), graphView);

  manager.addExpression("sin(x)");
  manager.addExpression("");

  document.getElementById("add-expr").addEventListener("click", () => {
    manager.addExpression("");
  });

  document.getElementById("reset-view").addEventListener("click", () => {
    graphView.resetView();
  });

  document.getElementById("zoom-in").addEventListener("click", () => {
    graphView.zoomAtCenter(1.3);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    graphView.zoomAtCenter(1 / 1.3);
  });

  graphView.render(manager.expressions);
});
