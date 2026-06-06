---
name: Recharts charts appear tiny/collapsed in screenshots
description: Why Recharts charts look broken in app_preview screenshots and how to verify them
---

When a Recharts chart (especially PieChart with a radial sweep) looks tiny, collapsed, or like a thin colored sliver in `app_preview` screenshots — but other charts on the same page look fine — the cause is usually the **entrance animation being caught mid-frame**, not a sizing/layout bug.

**Why:** Recharts animates `isAnimationActive` by default. The screenshot tool captures shortly after load, repeatedly at roughly the same frame, so every screenshot shows the same partial/tiny render. A PieChart mid-sweep looks like a tiny offset shape; an AreaChart mid-grow still looks like a filled area, which is why area charts seem "fine."

**How to apply:** Don't chase it as a ResponsiveContainer measurement bug. Set `isAnimationActive={false}` on the chart series to make rendering deterministic and verifiable in screenshots (also better UX — no re-animation on every navigation). Separately, ResponsiveContainer *can* genuinely collapse inside constrained CSS grid columns or `flex items-center justify-center` wrappers — for small fixed charts prefer explicit numeric `width`/`height` (e.g. `<PieChart width={250} height={250}>`) inside a centered flex wrapper.
