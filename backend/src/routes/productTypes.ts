// GET /api/product-types and its admin-only CRUD. The endpoints themselves
// are `createTypeRouter`, shared with the sub-product types (see there).
import { productTypePayloadSchema } from '../schemas/productTypes.schema.js';
import { ErrorCodes } from '../errorCodes.js';
import { createTypeRouter } from './typeRoutes.js';

export default createTypeRouter({
  table: 'product_types',
  schema: productTypePayloadSchema,
  codes: {
    invalidId: ErrorCodes.INVALID_PRODUCT_TYPE_ID,
    notFound: ErrorCodes.PRODUCT_TYPE_NOT_FOUND,
    alreadyExists: ErrorCodes.PRODUCT_TYPE_ALREADY_EXISTS,
    inUse: ErrorCodes.PRODUCT_TYPE_IN_USE,
  },
});
