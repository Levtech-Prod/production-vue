<template>
  <div class="grid min-h-screen place-items-center bg-slate-950 p-6">
    <form class="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl" @submit.prevent="submit">
      <h1 class="text-2xl font-bold">Sign up</h1><p class="mt-1 text-sm text-slate-500">Create admin or client user</p>
      <div class="mt-6 space-y-4">
        <input v-model="form.username" class="input" placeholder="Username" />
        <input v-model="form.email" class="input" placeholder="Email" />
        <input v-model="form.phone" class="input" placeholder="Phone" />
        <input v-model="form.password" type="password" class="input" placeholder="Password" />
        <label class="flex items-center gap-2 text-sm"><input v-model="form.admin" type="checkbox" class="h-4 w-4" /> Admin user</label>
      </div>
      <p v-if="error" class="mt-4 text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary mt-6 w-full">Sign up</button>
      <RouterLink class="mt-4 block text-center text-sm text-blue-600" to="/login">Already registered?</RouterLink>
    </form>
  </div>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
const router = useRouter(); const auth = useAuthStore(); const error = ref('');
const form = reactive({ username:'', email:'', phone:'', password:'', admin:false });
async function submit(){ try { await auth.signup(form); router.push('/dashboard'); } catch { error.value = 'Could not create user'; } }
</script>
