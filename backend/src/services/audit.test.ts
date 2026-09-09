// ===========================================================================
// `changeSet` / `writeAudit` / `imageChange` — the refactor replaced twelve
// hand-written "did anything actually change?" guards with one rule. If that
// rule is wrong, the change log either grows empty rows or silently loses
// real edits, and nothing else in the system notices either way.
//
// Runs against a FAKE client, so it needs no database. Run: npm run test:unit
// ===========================================================================
import type { PoolClient } from 'pg';
import { changeSet, writeAudit, imageChange, diffFields } from './audit.js';
import { check, report } from '../testing/check.js';

/** Records the statements a write would have issued. */
function recordingClient(): { client: PoolClient; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: async (text: string) => {
      statements.push(text.trim().split(/\s+/).slice(0, 2).join(' '));
      // `resolveActor` reads a username; an empty result is a null actor.
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: client as unknown as PoolClient, statements };
}

async function main() {
  // --- changeSet: only the parts that carry something --------------------
  check('nothing changed is an empty payload', changeSet({}, []), {});
  check(
    'empty events are left out rather than logged as []',
    changeSet({ name: { from: 'a', to: 'b' } }, []),
    { fields: { name: { from: 'a', to: 'b' } } },
  );
  check(
    'empty fields are left out too',
    changeSet({}, [{ type: 'part', tag: 'added', label: 'Screw' }]),
    { events: [{ type: 'part', tag: 'added', label: 'Screw' }] },
  );
  check(
    'extra payload survives on its own',
    changeSet({}, [], { regeneratedPartNames: 4 }),
    { regeneratedPartNames: 4 },
  );

  // --- writeAudit: an update that changed nothing leaves no trail ---------
  {
    const { client, statements } = recordingClient();
    await writeAudit(client, 'project', 1, 'updated', changeSet({}, []), 7);
    check('an empty change set writes nothing at all', statements, []);
  }
  {
    const { client, statements } = recordingClient();
    await writeAudit(client, 'project', 1, 'updated', { fields: { status: { from: 'draft', to: 'started' } } }, 7);
    check(
      'a real change resolves the actor and inserts one row',
      statements,
      ['SELECT username', 'INSERT INTO'],
    );
  }
  {
    // Creates and deletes carry a snapshot, which is never empty — the guard
    // must not swallow them. With no authenticated user there is no username
    // to resolve, so the row is written with a null actor and no lookup.
    const { client, statements } = recordingClient();
    await writeAudit(client, 'part', 2, 'created', { snapshot: { name: 'Screw' } }, undefined);
    check('a creation snapshot is logged even with no actor', statements, ['INSERT INTO']);
  }

  // --- imageChange: the log records that it changed, never the value ------
  check('an unchanged image is not a change', imageChange('/uploads/a.png', '/uploads/a.png'), null);
  check('null and undefined read as the same absence', imageChange(null, undefined), null);
  check(
    'a replaced image never puts the path in the log',
    imageChange('/uploads/a.png', '/uploads/b.png'),
    { from: '(image)', to: '(image)' },
  );
  check('an added image', imageChange(null, '/uploads/b.png'), { from: null, to: '(image)' });
  check('a removed image', imageChange('/uploads/a.png', null), { from: '(image)', to: null });

  // --- diffFields still normalises the way the routes rely on ------------
  check(
    'NUMERIC-as-string compares equal to its number',
    diffFields({ q: '0.120' }, { q: 0.12 }, ['q']),
    {},
  );
  check(
    'empty string and null are both "no value"',
    diffFields({ note: '' }, { note: null }, ['note']),
    {},
  );

  process.exit(report() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
