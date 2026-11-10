// Apply the industry directory on deployment without deleting unrelated administrator topics.
import { sql, closeDb } from '@aihot/backend/db';
import { seedTopics } from '@aihot/backend/publication/topics';
const retired = ['diplomacy-embassies','diplomacy-consular','diplomacy-meetings','diplomacy-forums',
  'diplomacy-summits','diplomacy-participation','diplomacy-joint-statements','diplomacy-un',
  'diplomacy-nato','diplomacy-asean','diplomacy-au','diplomacy-sco','diplomacy-brics'];
try {
  const topics = await seedTopics();
  const removed = await sql`DELETE FROM topics WHERE grp='genre' AND slug IN ${sql(retired)}`;
  console.log(JSON.stringify({topics,retired:removed.count}));
} finally { await closeDb(); }
