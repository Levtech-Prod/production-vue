<template>
  <!-- A solid document tile carrying the extension, so a .hex reads as a .hex
       at a glance and a release of mixed files scans by colour. `currentColor`
       throughout: the family class tints the body, and the folded corner is a
       white overlay so it works for every colour without a second class. -->
  <span class="relative inline-flex shrink-0" :class="colorClass">
    <svg viewBox="0 0 34 42" class="h-8 w-[1.62rem]" aria-hidden="true">
      <path
        d="M3 0h17.2L34 12.6V39a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z"
        fill="currentColor"
      />
      <path d="M20.2 0 34 12.6H22.2a2 2 0 0 1-2-2V0Z" fill="#fff" fill-opacity="0.45" />
    </svg>
    <span
      class="absolute inset-x-0 bottom-[5px] text-center text-[7px] font-bold uppercase leading-none tracking-tight text-white"
    >
      {{ label }}
    </span>
    <span class="sr-only">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { fileExtension } from './revisionFileHelpers.ts';

const props = defineProps<{ fileName: string }>();

const extension = computed(() => fileExtension(props.fileName));

/** Four characters is what fits the tile; longer extensions are rare and still
 *  recognisable truncated ('kicad_pcb' -> 'KICA'). */
const label = computed(() => (extension.value || '?').slice(1, 5) || '?');

// Grouped by what the file IS to someone browsing a release, not by MIME
// family: the image you flash, the build artifacts beside it, the source
// archive, the board data, the paperwork, the tool you run.
const FAMILIES: Record<string, string> = {
  '.hex': 'binary', '.bin': 'binary', '.uf2': 'binary', '.dfu': 'binary',
  '.s19': 'binary', '.srec': 'binary', '.mot': 'binary',

  '.elf': 'build', '.map': 'build', '.lst': 'build', '.lss': 'build', '.o': 'build',

  '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.gz': 'archive', '.tar': 'archive',

  '.pdf': 'doc', '.doc': 'doc', '.docx': 'doc', '.txt': 'doc', '.md': 'doc',
  '.csv': 'doc', '.json': 'doc', '.xml': 'doc', '.log': 'doc',
  '.xls': 'doc', '.xlsx': 'doc',

  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
  '.webp': 'image', '.bmp': 'image', '.tif': 'image', '.tiff': 'image',

  '.step': 'cad', '.stp': 'cad', '.iges': 'cad', '.igs': 'cad', '.stl': 'cad',
  '.dxf': 'cad', '.dwg': 'cad', '.gbr': 'cad', '.drl': 'cad',
  '.kicad_pcb': 'cad', '.kicad_sch': 'cad', '.sch': 'cad', '.brd': 'cad',

  '.exe': 'tool', '.msi': 'tool', '.bat': 'tool', '.cmd': 'tool',
  '.sh': 'tool', '.jar': 'tool', '.apk': 'tool', '.app': 'tool',
};

// Six hues, kept far enough apart to stay distinct at 32px — an earlier teal
// `data` family was indistinguishable from emerald `binary` and was folded
// into `doc` instead. Colour is the secondary cue anyway; the label on the
// tile is what identifies the file.
//
// `tool` stays deliberately muted: it is the one family that carries a warning
// chip, and a loud colour would read as "featured" rather than "handle with
// care".
const FAMILY_COLORS: Record<string, string> = {
  binary: 'text-emerald-500',
  build: 'text-amber-500',
  archive: 'text-violet-500',
  doc: 'text-sky-500',
  image: 'text-rose-400',
  cad: 'text-indigo-500',
  tool: 'text-slate-400',
};

const colorClass = computed(
  () => FAMILY_COLORS[FAMILIES[extension.value] ?? ''] ?? 'text-slate-400',
);
</script>
