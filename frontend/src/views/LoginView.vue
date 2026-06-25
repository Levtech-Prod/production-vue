<template>
  <div class="grid min-h-screen place-items-center bg-slate-950 p-6">
    <form
      class="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
      @submit.prevent="submit"
    >
      <h1 class="text-2xl font-bold">{{ t('login') }}</h1>
      <p class="mt-1 text-sm text-slate-500">{{ t('login_description') }}</p>
      <div class="mt-6 space-y-4">
        <input v-model="email" class="input" :placeholder="t('email')" /><input
          v-model="password"
          type="password"
          class="input"
          :placeholder="t('password')"
        />
      </div>
      <p v-if="error" class="mt-4 text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary mt-6 w-full">{{ t('login') }}</button>
      <RouterLink
        class="mt-4 block text-center text-sm text-blue-600"
        to="/signup"
        >{{ t('create_account') }}</RouterLink
      >
    </form>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useI18n } from 'vue-i18n';

const email = ref('');
const password = ref('');
const error = ref('');
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

async function submit() {
  try {
    await auth.login(email.value, password.value);
    router.push('/dashboard');
  } catch {
    error.value = t('invalid_login_data');
  }
}
</script>
