<script setup>
import { computed, onMounted, ref } from 'vue';
import { TxStack } from '@talex-touch/tuffex/stack';
import { TxFlex } from '@talex-touch/tuffex/flex';
import { TxNavBar } from '@talex-touch/tuffex/nav-bar';
import { TxSidebarNav } from '@talex-touch/tuffex/sidebar-nav';
import { TxTag } from '@talex-touch/tuffex/tag';
import { TxSpinner } from '@talex-touch/tuffex/spinner';
import { overview, loading, loadOverview } from './api.js';
import RoadmapView from './views/RoadmapView.vue';
import ReviewView from './views/ReviewView.vue';
import InsightView from './views/InsightView.vue';
import ProblemDrawer from './views/ProblemDrawer.vue';

const nav = ref('roadmap');
const activeId = ref(null);

const dueCount = computed(
  () => overview.value?.problems.filter((p) => p.overdue).length ?? 0,
);
const startedCount = computed(
  () => overview.value?.problems.filter((p) => p.started).length ?? 0,
);

const navItems = computed(() => [
  { value: 'roadmap', label: '路线', icon: 'i-carbon-roadmap', badge: startedCount.value || undefined },
  { value: 'review', label: '复习', icon: 'i-carbon-repeat', badge: dueCount.value || undefined },
  { value: 'insight', label: '洞察', icon: 'i-carbon-chart-line' },
]);

const views = { roadmap: RoadmapView, review: ReviewView, insight: InsightView };

function pick(id) {
  activeId.value = id;
}

async function refresh() {
  await loadOverview();
}

onMounted(refresh);
</script>

<template>
  <TxStack direction="vertical" :gap="0" style="height: 100vh">
    <TxNavBar title="算法工作台">
      <template #right>
        <TxTag v-if="overview" :label="overview.today" variant="plain" />
      </template>
    </TxNavBar>

    <TxFlex :gap="0" align="stretch" style="flex: 1; min-height: 0">
      <TxSidebarNav
        v-model="nav"
        :items="navItems"
        style="flex: none"
      />
      <TxStack
        direction="vertical"
        :gap="18"
        style="flex: 1; min-height: 0; overflow-y: auto; padding: 20px"
      >
        <TxFlex v-if="loading && !overview" justify="center" style="padding: 60px 0">
          <TxSpinner />
        </TxFlex>
        <component
          v-else-if="overview"
          :is="views[nav]"
          :data="overview"
          @pick="pick"
        />
      </TxStack>
    </TxFlex>
  </TxStack>

  <ProblemDrawer
    :problem-id="activeId"
    @close="activeId = null"
    @changed="refresh"
  />
</template>
