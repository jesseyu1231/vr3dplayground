<!--
  Full minimal Vue 3 example — prompt → generate → render.
-->
<script setup lang="ts">
import { ref } from "vue";
import { useTripoModel } from "./useTripoModel";
import TripoViewer from "./TripoViewer.vue";

const prompt = ref("a low-poly red apple");
const { generate, status, progress, glbUrl, error, isGenerating } = useTripoModel();

async function onGenerate() {
  await generate({ prompt: prompt.value });
}
</script>

<template>
  <div class="app">
    <div class="controls">
      <input v-model="prompt" placeholder="Describe the model" />
      <button :disabled="isGenerating" @click="onGenerate">
        {{ isGenerating ? "Generating…" : "Generate" }}
      </button>
    </div>
    <div class="status">
      <span v-if="isGenerating" class="info">{{ status }} — {{ progress }}%</span>
      <span v-if="error" class="err">Error: {{ error }}</span>
    </div>
    <div class="viewer">
      <TripoViewer :glb-url="glbUrl" />
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }
.controls { padding: 12px; display: flex; gap: 8px; }
.controls input { flex: 1; padding: 8px; }
.status { padding: 4px 12px; font-size: 13px; }
.status .info { color: #08f; }
.status .err { color: #f44; }
.viewer { flex: 1; }
</style>
