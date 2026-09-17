// GET /api/sub-product-types and its admin-only CRUD. The endpoints themselves
// are `createTypeRouter`, shared with the product types (see there).
import { ErrorCodes } from '../errorCodes.js';
import { createTypeRouter } from './typeRoutes.js';

export default createTypeRouter({
  table: 'sub_product_types',
  codes: {
    invalidId: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID,
    notFound: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND,
    alreadyExists: ErrorCodes.SUB_PRODUCT_TYPE_ALREADY_EXISTS,
    inUse: ErrorCodes.SUB_PRODUCT_TYPE_IN_USE,
  },
});
