<template>
  <div class="grid min-h-screen place-items-center bg-slate-950 p-6">
    <form
      class="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
      @submit.prevent="submit"
    >
      <h1 class="text-2xl font-bold">{{ t('sign_up') }}</h1>
      <p class="mt-1 text-sm text-slate-500">
        {{ t('create_user_description') }}
      </p>
      <div class="mt-6 space-y-4">
        <input
          v-model="form.username"
          class="input"
          :placeholder="t('username')"
        />
        <input v-model="form.email" class="input" :placeholder="t('email')" />
        <input v-model="form.phone" class="input" :placeholder="t('phone')" />
        <input
          v-model="form.password"
          type="password"
          class="input"
          :placeholder="t('password')"
        />
        <label class="flex items-center gap-2 text-sm"
          ><input v-model="form.admin" type="checkbox" class="h-4 w-4" />
          {{ t('admin_user') }}</label
        >
      </div>
      <p v-if="error" class="mt-4 text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary mt-6 w-full">{{ t('sign_up') }}</button>
      <RouterLink
        class="mt-4 block text-center text-sm text-blue-600"
        to="/login"
        >{{ t('already_registered') }}</RouterLink
      >
    </form>
  </div>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const error = ref('');
const form = reactive({
  username: '',
  email: '',
  phone: '',
  password: '',
  admin: false,
});
async function submit() {
  try {
    await auth.signup(form);
    router.push('/dashboard');
  } catch {
    error.value = t('could_not_create_user');
  }
}
</script>
