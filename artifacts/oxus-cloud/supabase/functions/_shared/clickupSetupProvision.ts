import { OXUS_CLICKUP_FOLDER_NAME, OXUS_CLICKUP_LIST_NAME } from "./clickupTemplate.ts";
import { clickupFetch } from "./clickup.ts";

export async function provisionDeliveryListInSpace(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
  spaceId: string,
): Promise<{ folderId: string; listId: string; folderName: string; listName: string }> {
  const folderName = OXUS_CLICKUP_FOLDER_NAME;
  const listName = OXUS_CLICKUP_LIST_NAME;

  const foldersResp = await clickupFetch(clickup, `/space/${spaceId}/folder?archived=false`);
  const folders = Array.isArray(foldersResp?.folders) ? foldersResp.folders : [];
  let folderId = folders.find((f: { name?: string }) => f.name === folderName)?.id;
  if (!folderId) {
    const folderResp = await clickupFetch(clickup, `/space/${spaceId}/folder`, {
      method: "POST",
      body: JSON.stringify({ name: folderName }),
    });
    folderId = folderResp.id;
  }
  const folderIdStr = String(folderId);

  const listsResp = await clickupFetch(clickup, `/folder/${folderIdStr}/list?archived=false`);
  const lists = Array.isArray(listsResp?.lists) ? listsResp.lists : [];
  let listId = lists.find((l: { name?: string }) => l.name === listName)?.id;
  if (!listId) {
    const listResp = await clickupFetch(clickup, `/folder/${folderIdStr}/list`, {
      method: "POST",
      body: JSON.stringify({ name: listName }),
    });
    listId = listResp.id;
  }

  return {
    folderId: folderIdStr,
    listId: String(listId),
    folderName,
    listName,
  };
}
