import { PhotoGallery, parseGalleryParams } from "@/components/issues/PhotoGallery";
import { getIssuesContext } from "@/modules/issues/server";

export default async function PhotosPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ filter?: string; page?: string }> }) {
  const { projectId } = await params;
  const ctx = await getIssuesContext(projectId);
  const { filter, page } = parseGalleryParams(await searchParams);
  return <PhotoGallery ctx={ctx} basePath={`/projects/${projectId}/issues/photos`} filter={filter} page={page} />;
}
