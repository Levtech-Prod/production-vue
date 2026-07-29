// Maps audit `changes.fields` keys to i18n keys, per entity. Keeping this out
// of the generic ChangeLogTable lets the same component serve parts, part
// categories and products — each entity just registers its field labels here.

export const PART_FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'field_name',
  code: 'field_code',
  category: 'field_category',
  price: 'field_price',
  location: 'field_location',
  description: 'field_description',
  image: 'field_image',
};

const LABELS_BY_ENTITY: Record<string, Record<string, string>> = {
  part: PART_FIELD_LABEL_KEYS,
};

/** i18n key for a field of `entityType`, or the raw key if none is registered. */
export function fieldLabelKey(entityType: string, field: string): string {
  return LABELS_BY_ENTITY[entityType]?.[field] ?? field;
}
