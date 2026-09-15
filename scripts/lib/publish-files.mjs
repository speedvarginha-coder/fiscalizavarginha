import fs from "node:fs";
import crypto from "node:crypto";

// Executado sob o lock do pipeline. Cada troca é atômica; falha no lote
// recompõe os arquivos já trocados antes de devolver o erro ao chamador.
export function publishFiles(entries, { io = fs, attempts = 8, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  const temporary = new Set();
  const committed = [];
  const retry = action => {
    for (let attempt = 0; ; attempt++) {
      try { return action(); } catch (error) {
        if (!new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN", "EINVAL"]).has(error.code) || attempt + 1 >= attempts) throw error;
        wait(125 * (attempt + 1));
      }
    }
  };
  const stage = (target, content) => {
    const file = `${target}.${crypto.randomUUID()}.tmp`;
    temporary.add(file);
    retry(() => io.writeFileSync(file, content));
    return file;
  };
  try {
    const prepared = entries.map(([target, content]) => ({
      target,
      previous: io.existsSync(target) ? io.readFileSync(target) : null,
      file: stage(target, content),
    }));
    try {
      for (const item of prepared) {
        retry(() => io.renameSync(item.file, item.target));
        committed.push(item);
      }
    } catch (error) {
      const failures = [error];
      for (const item of committed.reverse()) {
        try {
          if (item.previous === null) retry(() => io.unlinkSync(item.target));
          else retry(() => io.renameSync(stage(item.target, item.previous), item.target));
        } catch (restoreError) { failures.push(restoreError); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "Falha na gravação e na restauração; requer recuperação pelo backup do pipeline.");
      throw error;
    }
  } finally {
    for (const file of temporary) {
      try { if (io.existsSync(file)) io.unlinkSync(file); } catch { /* preserva o erro original */ }
    }
  }
}
