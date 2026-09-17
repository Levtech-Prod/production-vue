// ===========================================================================
// `revisionUpdateAssignments` — the one place the refactor replaced literal
// SQL parameter numbers with computed ones, for both revision PATCH routes.
// An off-by-one here either throws "bind message supplies N parameters" or,
// worse, updates a row identified by the wrong parameter.
//
// Pure function, no database. Run: npm run test:unit
// ===========================================================================
import { revisionUpdateAssignments } from './revisions.schema.js';
import { check, report } from '../testing/check.js';

// The two statements these feed, so the assertions below read as the SQL the
// routes actually build.
const productWhere = (values: unknown[]) => `WHERE id = $${values.length}`;
const subProductWhere = (values: unknown[]) =>
  `WHERE sub_product_id = $${values.length - 1} AND id = $${values.length}`;

function main() {
  {
    const { assignments, values } = revisionUpdateAssignments({});
    check('an empty patch assigns nothing', [assignments, values], [[], []]);
  }

  {
    const { assignments, values } = revisionUpdateAssignments({ label: 'Rev. 2' });
    check('one field is $1', assignments, ['label = $1']);
    values.push(7);
    check('and the product route binds the id after it', productWhere(values), 'WHERE id = $2');
    check('with the values in that order', values, ['Rev. 2', 7]);
  }

  {
    const { assignments, values } = revisionUpdateAssignments({
      label: 'Rev. 2',
      status: 'active',
      changeNotes: 'notes',
    });
    check(
      'all three number consecutively',
      assignments,
      ['label = $1', 'status = $2', 'change_notes = $3'],
    );
    values.push(7);
    check('product route id lands on $4', productWhere(values), 'WHERE id = $4');
    check('values match the placeholders', values, ['Rev. 2', 'active', 'notes', 7]);
  }

  {
    // The sub-product route binds two trailing ids, so its offsets are the
    // ones most likely to drift.
    const { assignments, values } = revisionUpdateAssignments({ status: 'deprecated' });
    check('a middle-only patch still starts at $1', assignments, ['status = $1']);
    values.push(3, 9);
    check(
      'sub-product route binds parent then revision',
      subProductWhere(values),
      'WHERE sub_product_id = $2 AND id = $3',
    );
    check('and in that order', values, ['deprecated', 3, 9]);
  }

  {
    const { assignments, values } = revisionUpdateAssignments({
      label: 'Rev. 3',
      status: 'draft',
      changeNotes: null,
    });
    values.push(3, 9);
    check(
      'full patch on the sub-product route',
      subProductWhere(values),
      'WHERE sub_product_id = $4 AND id = $5',
    );
    check('an explicit null clears the notes', values[2], null);
  }

  {
    // '' means "clear it", the same normalisation the routes did by hand.
    const { values } = revisionUpdateAssignments({ changeNotes: '' });
    check('an empty note is stored as NULL', values, [null]);
  }

  {
    // The count of placeholders must always equal the count of values, or the
    // driver rejects the statement.
    for (const patch of [
      {},
      { label: 'a' },
      { status: 'active' as const },
      { changeNotes: 'n' },
      { label: 'a', status: 'active' as const },
      { label: 'a', status: 'active' as const, changeNotes: 'n' },
    ]) {
      const { assignments, values } = revisionUpdateAssignments(patch);
      const placeholders = assignments.map((a) => a.split('$')[1]).join(',');
      const expected = values.map((_, i) => String(i + 1)).join(',');
      check(`placeholders match values for ${JSON.stringify(patch)}`, placeholders, expected);
    }
  }

  process.exit(report() === 0 ? 0 : 1);
}

main();
