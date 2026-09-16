"use strict";

/* ---------------------------------------------------------------------
 * Math expression parser: tokenizer -> shunting-yard -> RPN evaluator
 * Supports: + - * / ^ %  unary +/-  ( )  ,
 * Builtin functions: sin cos tan asin acos atan sinh cosh tanh sqrt abs
 *                     log ln exp floor ceil round sign min max
 * Constants: pi e
 * Plus a small "environment" layer on top so a whole calculator page can
 * paste in Desmos-style scripts like:
 *   a=-1
 *   V_a=0
 *   s(x)=min(1,max(0,x))
 *   F(x,p,q,m,n)=m+(n-m)s((x-p)/(q-p))
 *   y=F(x,b,c,F(x,a,b,V_a,V_b),V_c)
 *   (a,V_a),(b,V_b),(c,V_c)
 * i.e. bare "name=expr" defines a global variable, "name(p,...)=expr"
 * defines a callable function, "y=expr" (or a bare expression) is the
 * plotted curve, and a comma-separated list of "(expr,expr)" pairs is
 * plotted as discrete points. See classifyExpression() below.
 * Implicit multiplication: 2x, 2(x+1), x(x+1), (x+1)(x-1), (x+1)2
 * ------------------------------------------------------------------- */

const BUILTIN_FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "sqrt", "abs", "log", "ln",
  "exp", "floor", "ceil", "round", "sign", "min", "max",
]);
const CONSTANTS = { pi: Math.PI, e: Math.E };

class ParseError extends Error {}

// `knownVars`: bare identifiers that should tokenize as a single variable
// (always includes "x", plus any global variable names and, when compiling
// a function body, that function's own parameter names).
// `funcNames`: identifiers that should tokenize as a function call when
// immediately followed by "(" (builtins plus every user-defined function).
function tokenize(input, knownVars, funcNames) {
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
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      let name = src.slice(i, j);
      // Followed immediately by '(' and a known function name -> function call
      if (funcNames.has(name) && src[j] === "(") {
        tokens.push({ type: "FUNC", value: name });
        i = j;
        continue;
      }
      if (CONSTANTS.hasOwnProperty(name)) {
        tokens.push({ type: "CONST", value: name });
        i = j;
        continue;
      }
      if (knownVars.has(name)) {
        tokens.push({ type: "IDENT", value: name });
        i = j;
        continue;
      }
      // A name containing "_" can only ever be a single identifier (e.g.
      // "V_a") -- splitting it letter-by-letter wouldn't mean anything, so
      // an unrecognized one is a hard error rather than a decomposition
      // candidate.
      if (name.includes("_")) {
        throw new ParseError(`未定義の変数・関数です: "${name}"`);
      }
      // Try to decompose into known pieces via implicit multiplication,
      // e.g. "2pix" -> 2 * pi * x, or "ab" -> a * b when both are defined.
      const candidates = [...knownVars, ...Object.keys(CONSTANTS)]
        .filter((n) => !n.includes("_"))
        .sort((a, b) => b.length - a.length);
      let k = 0;
      let consumed = false;
      while (k < name.length) {
        let matched = false;
        for (const cand of candidates) {
          if (name.startsWith(cand, k)) {
            tokens.push(
              CONSTANTS.hasOwnProperty(cand)
                ? { type: "CONST", value: cand }
                : { type: "IDENT", value: cand }
            );
            k += cand.length;
            matched = true;
            consumed = true;
            break;
          }
        }
        if (matched) continue;
        throw new ParseError(`未定義の変数・関数です: "${name}"`);
      }
      if (!consumed) throw new ParseError(`未定義の変数・関数です: "${name}"`);
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
      throw new ParseError("式の中に \"=\" は使えません");
    } else {
      throw new ParseError(`使用できない文字です: "${c}"`);
    }
  }
  return tokens;
}

function isValueEnd(tok) {
  return tok && (tok.type === "NUM" || tok.type === "CONST" || tok.type === "IDENT" || tok.type === "RPAREN");
}
function isValueStart(tok) {
  return tok && (tok.type === "NUM" || tok.type === "CONST" || tok.type === "IDENT" || tok.type === "FUNC" || tok.type === "LPAREN");
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
  const argCounts = []; // tracks comma count for the innermost open function call
  let prevType = null; // to detect unary vs binary

  const peekIsOp = () => stack.length && stack[stack.length - 1].type === "OP";

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === "NUM" || tok.type === "CONST" || tok.type === "IDENT") {
      output.push(tok);
    } else if (tok.type === "FUNC") {
      stack.push(tok);
    } else if (tok.type === "COMMA") {
      while (stack.length && stack[stack.length - 1].type !== "LPAREN") {
        output.push(stack.pop());
      }
      if (!stack.length || !stack[stack.length - 1].isCall) {
        throw new ParseError("カンマの位置が不正です");
      }
      argCounts[argCounts.length - 1]++;
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
      const isCall = prevType === "FUNC";
      stack.push({ type: "LPAREN", isCall });
      if (isCall) argCounts.push(1);
    } else if (tok.type === "RPAREN") {
      let matchedParen = null;
      while (stack.length) {
        const top = stack.pop();
        if (top.type === "LPAREN") {
          matchedParen = top;
          break;
        }
        output.push(top);
      }
      if (!matchedParen) throw new ParseError("かっこが正しく閉じられていません");
      if (matchedParen.isCall) {
        const argc = argCounts.pop();
        if (stack.length && stack[stack.length - 1].type === "FUNC") {
          const funcTok = stack.pop();
          funcTok.argc = argc;
          output.push(funcTok);
        }
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

// opts: { paramNames: string[], variableNames: Set<string>, functionNames: Set<string> }
function compile(bodyText, opts) {
  const paramNames = (opts && opts.paramNames) || [];
  const variableNames = (opts && opts.variableNames) || new Set();
  const functionNames = (opts && opts.functionNames) || BUILTIN_FUNCTIONS;
  const text = bodyText.trim();
  if (text === "") throw new ParseError("式を入力してください");
  const knownVars = new Set(["x", ...paramNames, ...variableNames]);
  const tokens = insertImplicitMultiplication(tokenize(text, knownVars, functionNames));
  const rpn = toRPN(tokens);
  if (rpn.length === 0) throw new ParseError("式を入力してください");
  return rpn;
}

// `scope`: plain object of name -> number for the current call frame (e.g.
// {x: worldX} for the top-level plot, or a function's bound parameters).
// `env`: the Environment providing global variables/functions (see below).
// `stackGuard`: a Set used to detect circular variable/function references.
function evalRPN(rpn, scope, env, stackGuard) {
  scope = scope || {};
  stackGuard = stackGuard || new Set();
  const stack = [];
  for (const tok of rpn) {
    if (tok.type === "NUM") {
      stack.push(tok.value);
    } else if (tok.type === "CONST") {
      stack.push(CONSTANTS[tok.value]);
    } else if (tok.type === "IDENT") {
      if (Object.prototype.hasOwnProperty.call(scope, tok.value)) {
        stack.push(scope[tok.value]);
      } else if (env) {
        stack.push(env.resolveVariable(tok.value, stackGuard));
      } else {
        throw new ParseError(`未定義の変数です: "${tok.value}"`);
      }
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
      const nArgs = tok.argc != null ? tok.argc : 1;
      const args = [];
      for (let i = 0; i < nArgs; i++) args.unshift(stack.pop());
      if (BUILTIN_FUNCTIONS.has(tok.value)) {
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
      } else if (env && env.functions.has(tok.value)) {
        stack.push(env.callFunction(tok.value, args, stackGuard));
      } else {
        throw new ParseError(`未定義の関数です: "${tok.value}"`);
      }
    }
  }
  if (stack.length !== 1) throw new ParseError("式が不正です");
  return stack[0];
}

/* ---------------------------------------------------------------------
 * Environment: holds global variable/function definitions shared across
 * every expression row, rebuilt whenever any row's text changes.
 * ------------------------------------------------------------------- */

class Environment {
  constructor() {
    this.variables = new Map(); // name -> { rpn }
    this.functions = new Map(); // name -> { params, rpn }
    this._cache = new Map(); // memoized variable values for this environment's lifetime
  }

  resolveVariable(name, stackGuard) {
    if (this._cache.has(name)) return this._cache.get(name);
    const def = this.variables.get(name);
    if (!def) throw new ParseError(`未定義の変数です: "${name}"`);
    const guardKey = "var:" + name;
    if (stackGuard.has(guardKey)) throw new ParseError(`循環参照があります: "${name}"`);
    stackGuard.add(guardKey);
    const value = evalRPN(def.rpn, {}, this, stackGuard);
    stackGuard.delete(guardKey);
    this._cache.set(name, value);
    return value;
  }

  callFunction(name, args, stackGuard) {
    const def = this.functions.get(name);
    if (!def) throw new ParseError(`未定義の関数です: "${name}"`);
    if (def.params.length !== args.length) {
      throw new ParseError(
        `${name} の引数の数が正しくありません(必要: ${def.params.length}個, 実際: ${args.length}個)`
      );
    }
    const scope = {};
    def.params.forEach((p, i) => {
      scope[p] = args[i];
    });
    const guardKey = "fn:" + name + ":" + args.join(",");
    if (stackGuard.has(guardKey)) throw new ParseError(`循環参照があります: "${name}"`);
    stackGuard.add(guardKey);
    const value = evalRPN(def.rpn, scope, this, stackGuard);
    stackGuard.delete(guardKey);
    return value;
  }
}

/* ---------------------------------------------------------------------
 * Row classification: decides whether a pasted/typed line is a variable
 * definition, a function definition, a plotted curve, or a point list.
 * ------------------------------------------------------------------- */

const FUNC_DEF_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\(\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\)\s*=\s*(.+)$/;
const VAR_DEF_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/;

function splitTopLevelComma(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

// Parses "(expr,expr),(expr,expr),..." into [{xText, yText}, ...], or
// returns null if `text` doesn't fully match that shape (so the caller can
// fall back to treating it as an ordinary expression).
function tryParsePointList(text) {
  let i = 0;
  const points = [];
  const skipWs = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  while (true) {
    skipWs();
    if (i >= text.length) break;
    if (text[i] !== "(") return null;
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) return null;
    const inner = text.slice(start + 1, i - 1);
    const parts = splitTopLevelComma(inner);
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
    points.push({ xText: parts[0].trim(), yText: parts[1].trim() });
    skipWs();
    if (i < text.length && text[i] === ",") {
      i++;
      continue;
    }
    break;
  }
  skipWs();
  if (i !== text.length || points.length === 0) return null;
  return points;
}

function classifyExpression(rawText) {
  const text = rawText.trim();
  if (text === "") return { kind: "empty" };

  const funcMatch = text.match(FUNC_DEF_RE);
  if (funcMatch) {
    const params = funcMatch[2].split(",").map((p) => p.trim());
    return { kind: "funcdef", name: funcMatch[1], params, bodyText: funcMatch[3] };
  }

  const varMatch = text.match(VAR_DEF_RE);
  if (varMatch) {
    if (varMatch[1] === "y") {
      return { kind: "plot", bodyText: varMatch[2] };
    }
    return { kind: "vardef", name: varMatch[1], bodyText: varMatch[2] };
  }

  if (text[0] === "(") {
    const points = tryParsePointList(text);
    if (points) return { kind: "points", points };
  }

  return { kind: "plot", bodyText: text };
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

  render(expressions, env) {
    this._lastExpressions = expressions || this._lastExpressions || [];
    this._lastEnv = env || this._lastEnv || null;
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
      if (expr.kind !== "plot" || !expr.visible || !expr.rpn) continue;
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
          wy = evalRPN(expr.rpn, { x: wx }, this._lastEnv, new Set());
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

    // Point sets, e.g. "(a,V_a),(b,V_b),(c,V_c)"
    for (const expr of this._lastExpressions) {
      if (expr.kind !== "points" || !expr.visible || !expr.points || expr.error) continue;
      for (const pt of expr.points) {
        let wx, wy;
        try {
          wx = evalRPN(pt.xRpn, {}, this._lastEnv, new Set());
          wy = evalRPN(pt.yRpn, {}, this._lastEnv, new Set());
        } catch (err) {
          continue;
        }
        if (!isFinite(wx) || !isFinite(wy)) continue;
        const s = this.worldToScreen(wx, wy);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = expr.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
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
    this.env = new Environment();
  }

  addExpression(initialText = "") {
    const expr = {
      id: this.nextId++,
      text: initialText,
      color: PALETTE[this.colorIndex % PALETTE.length],
      visible: true,
      kind: "plot",
      rpn: null,
      points: null,
      error: null,
      definedName: null,
    };
    this.colorIndex++;
    this.expressions.push(expr);
    this._rebuildEnvironment();
    this._renderList();
    this._focusExpr(expr.id);
    this._rerenderGraph();
    return expr;
  }

  removeExpression(id) {
    this.expressions = this.expressions.filter((e) => e.id !== id);
    this._rebuildEnvironment();
    this._renderList();
    this._rerenderGraph();
  }

  // Re-classifies and re-compiles every row from scratch, since rows can
  // reference variables/functions defined in *other* rows (in any order).
  _rebuildEnvironment() {
    const env = new Environment();
    const functionNames = new Set(BUILTIN_FUNCTIONS);
    const variableNames = new Set();

    const classified = this.expressions.map((expr) => {
      const c = classifyExpression(expr.text);
      if (c.kind === "funcdef") functionNames.add(c.name);
      if (c.kind === "vardef") variableNames.add(c.name);
      return c;
    });

    classified.forEach((c, idx) => {
      const expr = this.expressions[idx];
      expr.kind = c.kind;
      expr.error = null;
      expr.rpn = null;
      expr.points = null;
      expr.definedName = c.name || null;
      if (c.kind === "empty") return;

      try {
        if (c.kind === "funcdef") {
          const rpn = compile(c.bodyText, { paramNames: c.params, variableNames, functionNames });
          env.functions.set(c.name, { params: c.params, rpn });
        } else if (c.kind === "vardef") {
          const rpn = compile(c.bodyText, { paramNames: [], variableNames, functionNames });
          env.variables.set(c.name, { rpn });
        } else if (c.kind === "plot") {
          expr.rpn = compile(c.bodyText, { paramNames: ["x"], variableNames, functionNames });
        } else if (c.kind === "points") {
          expr.points = c.points.map((p) => ({
            xRpn: compile(p.xText, { paramNames: [], variableNames, functionNames }),
            yRpn: compile(p.yText, { paramNames: [], variableNames, functionNames }),
          }));
        }
      } catch (err) {
        expr.error = err.message || "式が正しくありません";
      }
    });

    // Proactively evaluate definitions once so circular references (e.g.
    // a=b, b=a) surface as an error on their row even if nothing else ever
    // ends up referencing them.
    this.expressions.forEach((expr) => {
      if (expr.error) return;
      try {
        if (expr.kind === "vardef") {
          env.resolveVariable(expr.definedName, new Set());
        } else if (expr.kind === "funcdef") {
          const def = env.functions.get(expr.definedName);
          if (def) env.callFunction(expr.definedName, def.params.map(() => 0), new Set());
        }
      } catch (err) {
        expr.error = err.message || "式が正しくありません";
      }
    });

    this.env = env;
  }

  _focusExpr(id) {
    requestAnimationFrame(() => {
      const input = this.listEl.querySelector(`[data-id="${id}"] .expr-input`);
      if (input) input.focus();
    });
  }

  _rerenderGraph() {
    this.graphView.render(this.expressions, this.env);
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
        this._rebuildEnvironment();
        this._refreshAllRowStates();
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
      // A pasted multi-line script (variable/function definitions, a plot,
      // a point list, ...) is spread across one new row per line instead of
      // being dumped into a single input as one unparsable blob.
      input.addEventListener("paste", (e) => {
        const clipboard = e.clipboardData || window.clipboardData;
        const text = clipboard ? clipboard.getData("text") : "";
        if (!text || !text.includes("\n")) return;
        e.preventDefault();
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l !== "");
        if (lines.length === 0) return;
        expr.text = lines[0];
        if (lines.length === 1) {
          input.value = lines[0];
          this._rebuildEnvironment();
          this._refreshAllRowStates();
          this._rerenderGraph();
          return;
        }
        for (let k = 1; k < lines.length; k++) {
          this.addExpression(lines[k]);
        }
      });
      const trackActive = () => {
        this._activeExprId = expr.id;
        this._activeSelection = { start: input.selectionStart, end: input.selectionEnd };
      };
      input.addEventListener("focus", trackActive);
      input.addEventListener("click", trackActive);
      input.addEventListener("keyup", trackActive);
      input.addEventListener("select", trackActive);
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

      row.classList.toggle("is-definition", expr.kind === "vardef" || expr.kind === "funcdef");
      this.listEl.appendChild(row);
      this._showError(row, expr);
    });
  }

  // Refreshes error highlighting/messages and the "definition row" styling
  // for every row in place, without touching the DOM nodes themselves (a
  // full _renderList() would drop focus/cursor position while typing).
  _refreshAllRowStates() {
    this.expressions.forEach((expr) => {
      const row = this.listEl.querySelector(`.expr-row[data-id="${expr.id}"]`);
      if (!row) return;
      const input = row.querySelector(".expr-input");
      if (input) input.classList.toggle("error", !!expr.error);
      row.classList.toggle("is-definition", expr.kind === "vardef" || expr.kind === "funcdef");
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

  // Inserts `snippet` (e.g. "sin()", "pi", "+") into whichever expression
  // input was last focused/edited, at its last known cursor position.
  // Falls back to appending to the last expression if none was active.
  insertSnippet(snippet) {
    if (this.expressions.length === 0) this.addExpression("");

    let expr = this.expressions.find((e) => e.id === this._activeExprId);
    if (!expr) {
      expr = this.expressions[this.expressions.length - 1];
      this._activeExprId = expr.id;
    }

    const row = this.listEl.querySelector(`.expr-row[data-id="${expr.id}"]`);
    const input = row ? row.querySelector(".expr-input") : null;
    const text = expr.text || "";

    let start = text.length;
    let end = text.length;
    if (input && document.activeElement === input) {
      start = input.selectionStart;
      end = input.selectionEnd;
    } else if (this._activeSelection) {
      start = Math.min(this._activeSelection.start, text.length);
      end = Math.min(this._activeSelection.end, text.length);
    }

    const newText = text.slice(0, start) + snippet + text.slice(end);
    expr.text = newText;
    this._rebuildEnvironment();

    if (input) input.value = newText;
    this._refreshAllRowStates();
    this._rerenderGraph();

    const openIdx = snippet.indexOf("(");
    const cursorOffset = openIdx !== -1 && snippet.endsWith(")") ? openIdx + 1 : snippet.length;
    const newCursor = start + cursorOffset;
    this._activeSelection = { start: newCursor, end: newCursor };

    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(newCursor, newCursor);
      }
    });
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

  const helpOverlay = document.getElementById("help-overlay");
  document.getElementById("show-help").addEventListener("click", () => {
    helpOverlay.classList.remove("hidden");
  });
  document.getElementById("help-close").addEventListener("click", () => {
    helpOverlay.classList.add("hidden");
  });
  helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) helpOverlay.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") helpOverlay.classList.add("hidden");
  });
  document.getElementById("help-body").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-insert]");
    if (!chip) return;
    manager.insertSnippet(chip.dataset.insert);
  });

  graphView.render(manager.expressions, manager.env);
});
