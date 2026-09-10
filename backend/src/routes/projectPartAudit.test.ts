// ===========================================================================
// buildProjectPartQtyEvents — the from/to mapping the PATCH and recalculate
// routes both log to a project's audit trail (§5.6). Pure, so it runs with
// no database (CLAUDE.md's first test tier): this is the exact code a
// critique-branch review flagged as new, untested logic sitting only inside
// an Express handler — a swapped from/to or a mis-indexed lookup would have
// passed every other test in this repo and only surfaced the day someone
// opened the audit log to resolve a real purchasing dispute.
//
// Run: npm run test:unit
// ===========================================================================
import { check, report, failureCount } from '../testing/check.js';
import { buildProjectPartQtyEvents } from './projectPartAudit.js';

function main() {
  check(
    'a single change becomes one event with the sourcing columns paired in the label',
    buildProjectPartQtyEvents([
      {
        partName: 'Relay 5V',
        before: { fromStockQty: 6, missingQty: 20 },
        after: { fromStockQty: 0, missingQty: 26 },
      },
    ]),
    [
      {
        type: 'part',
        tag: 'changed',
        label: 'Relay 5V',
        from: 'From stock 6 · Missing 20',
        to: 'From stock 0 · Missing 26',
      },
    ],
  );

  // What a recalculate actually produces — several rows at once — and
  // exactly what the route's own inline `.map` (before this was pulled out)
  // was never checked against with more than one row: each part's own
  // before/after must stay paired with IT, not the row before or after it.
  check(
    "several changes keep each part's own before/after paired, in order, not shifted onto a neighbor",
    buildProjectPartQtyEvents([
      {
        partName: 'Screw M3',
        before: { fromStockQty: 6, missingQty: 20 },
        after: { fromStockQty: 0, missingQty: 26 },
      },
      {
        partName: 'Capacitor 100uF',
        before: { fromStockQty: 6, missingQty: 0 },
        after: { fromStockQty: 5, missingQty: 1 },
      },
      {
        partName: 'Relay 5V',
        before: { fromStockQty: 0, missingQty: 2 },
        after: { fromStockQty: 2, missingQty: 0 },
      },
    ]),
    [
      {
        type: 'part',
        tag: 'changed',
        label: 'Screw M3',
        from: 'From stock 6 · Missing 20',
        to: 'From stock 0 · Missing 26',
      },
      {
        type: 'part',
        tag: 'changed',
        label: 'Capacitor 100uF',
        from: 'From stock 6 · Missing 0',
        to: 'From stock 5 · Missing 1',
      },
      {
        type: 'part',
        tag: 'changed',
        label: 'Relay 5V',
        from: 'From stock 0 · Missing 2',
        to: 'From stock 2 · Missing 0',
      },
    ],
  );

  check('no changes produces no events, so an empty recalculate logs nothing', buildProjectPartQtyEvents([]), []);

  report();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main();
