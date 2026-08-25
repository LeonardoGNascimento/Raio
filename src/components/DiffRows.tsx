import type { DiffEntry } from "../lib/jsonDiff";
import { stringifyShort } from "../lib/format";

const SIGN: Record<DiffEntry["kind"], string> = {
  added: "＋",
  removed: "－",
  changed: "≠",
};
const CLS: Record<DiffEntry["kind"], string> = {
  added: "k-add",
  removed: "k-remove",
  changed: "k-change",
};

export function DiffRows({ diff, max = 500 }: { diff: DiffEntry[]; max?: number }) {
  return (
    <>
      {diff.slice(0, max).map((d, i) => (
        <div key={i} className={"diff-row " + CLS[d.kind]}>
          <span className="sign">{SIGN[d.kind]}</span>
          <div className="body">
            <div className="path">{d.path}</div>
            <div className="vals">
              {d.kind === "added" && (
                <span className="c-ok">apareceu → {stringifyShort(d.right)}</span>
              )}
              {d.kind === "removed" && (
                <span className="c-err">{stringifyShort(d.left)} → sumiu</span>
              )}
              {d.kind === "changed" && (
                <span>
                  <span className="v-before">{stringifyShort(d.left)}</span>
                  <span className="v-sep">›</span>
                  <span className="v-after">{stringifyShort(d.right)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      {diff.length > max && (
        <div className="hint-block">… +{diff.length - max} diferenças omitidas</div>
      )}
    </>
  );
}
