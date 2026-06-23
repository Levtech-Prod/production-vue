import { createI18n } from 'vue-i18n';

const messages = {
  en: {
    welcome: 'Welcome',
    login: 'Login',
    part_categories_title: 'Part Categories',
    add_part_category: 'Add Part Category',
    category: 'category',
    name: 'Name',
    image: 'Image',
    description: 'Description',
    parameters: 'Parameters',
    actions: 'Actions',
    no_categories_msg:
      'No categories yet. Click the "Add Category" button to create the first one.',
    no_search_results: 'No results found for',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    delete_part_category_error: 'The part category could not be deleted.',
    delete_part_category_success: 'The part category was deleted successfully.',
    delete_part_category_error_title: 'Deletion not possible',
    confirm_delete_category_msg:
      'Are you sure you want to delete this category?',
  },
  hu: {
    welcome: 'Üdvözöljük',
    login: 'Bejelentkezés',
    part_categories_title: 'Alkatrész kategóriák',
    add_part_category: 'Kategória hozzáadása',
    category: 'kategória',
    name: 'Név',
    image: 'Kép',
    description: 'Leírás',
    parameters: 'Paraméterek',
    actions: 'Műveletek',
    no_categories_msg:
      'Még nincs kategória. Kattints a „Kategória hozzáadása" gombra az első létrehozásához.',
    no_search_results: 'Nincs találat erre a keresésre:',
    cancel: 'Mégse',
    edit: 'Szerkesztés',
    delete: 'Törlés',
    delete_part_category_error: 'A kategória törlése nem sikerült.',
    delete_part_category_success: 'A kategória sikeresen törölve.',
    delete_part_category_error_title: 'Törlés nem lehetséges',
    confirm_delete_category_msg: 'Biztosan törölni szeretnéd ezt a kategóriát?',
  },
};

export const i18n = createI18n({
  legacy: false, // Composition API mode
  locale: 'hu',
  fallbackLocale: 'hu',
  messages,
});
