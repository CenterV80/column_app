/**
 * 評価が追いつかない間に来たリクエストは最新のものだけを残し、
 * 実行中のリクエストが完了し次第それだけを処理する（途中のリクエストは捨てる）。
 */
export class CoalescingQueue<Req, Res> {
  private readonly run: (req: Req) => Promise<Res>;
  private inFlight = false;
  private pending: { req: Req; onResult: (res: Res) => void } | null = null;
  private disposed = false;

  constructor(run: (req: Req) => Promise<Res>) {
    this.run = run;
  }

  request(req: Req, onResult: (res: Res) => void) {
    if (this.disposed) return;
    this.pending = { req, onResult };
    if (!this.inFlight) void this.pump();
  }

  dispose() {
    this.disposed = true;
    this.pending = null;
  }

  private async pump() {
    if (this.disposed || !this.pending) return;
    const { req, onResult } = this.pending;
    this.pending = null;
    this.inFlight = true;
    try {
      const res = await this.run(req);
      if (!this.disposed) onResult(res);
    } finally {
      this.inFlight = false;
      if (!this.disposed && this.pending) void this.pump();
    }
  }
}
