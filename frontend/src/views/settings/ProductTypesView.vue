<template>
  <div>
    <div>
      <h1 class="text-3xl font-bold">{{ t('product_types_settings_title') }}</h1>
    </div>

    <div class="mt-6 flex flex-col gap-6">
      <TypeManagerSection
        :title="t('product_types_section_title')"
        :add-label="t('add_product_type')"
        :edit-title="t('edit_product_type')"
        :delete-title="t('delete_product_type')"
        :delete-message-prefix="t('confirmations.delete_product_type_msg')"
        :empty-message="t('no_product_types_msg')"
        :items="productTypesStore.productTypes"
        :loading="productTypesStore.loading"
        :on-create="(name) => productTypesStore.createProductType({ name })"
        :on-update="(id, name) => productTypesStore.updateProductType(id, { name })"
        :on-delete="(id) => productTypesStore.deleteProductType(id)"
        save-error-fallback-key="errors.save_product_type_failed"
        delete-error-fallback-key="errors.delete_product_type_failed"
        :success-create-message="t('success.save_product_type')"
        :success-update-message="t('success.update_product_type')"
        :success-delete-message="t('success.delete_product_type')"
      >
        <template #expanded="{ item }">
          <DocumentTypesSection family="product" :type-id="item.id" />
        </template>
      </TypeManagerSection>

      <TypeManagerSection
        :title="t('sub_product_types_section_title')"
        :add-label="t('add_sub_product_type')"
        :edit-title="t('edit_sub_product_type')"
        :delete-title="t('delete_sub_product_type')"
        :delete-message-prefix="t('confirmations.delete_sub_product_type_msg')"
        :empty-message="t('no_sub_product_types_msg')"
        :items="productTypesStore.subProductTypes"
        :loading="productTypesStore.loading"
        :on-create="(name) => productTypesStore.createSubProductType({ name })"
        :on-update="(id, name) => productTypesStore.updateSubProductType(id, { name })"
        :on-delete="(id) => productTypesStore.deleteSubProductType(id)"
        save-error-fallback-key="errors.save_sub_product_type_failed"
        delete-error-fallback-key="errors.delete_sub_product_type_failed"
        :success-create-message="t('success.save_sub_product_type')"
        :success-update-message="t('success.update_sub_product_type')"
        :success-delete-message="t('success.delete_sub_product_type')"
      >
        <template #expanded="{ item }">
          <DocumentTypesSection family="sub-product" :type-id="item.id" />
        </template>
      </TypeManagerSection>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProductTypesStore } from '../../stores/productTypesStore.ts';
import TypeManagerSection from './TypeManagerSection.vue';
import DocumentTypesSection from './DocumentTypesSection.vue';

const { t } = useI18n();
const productTypesStore = useProductTypesStore();

onMounted(() => productTypesStore.loadAll());
</script>
