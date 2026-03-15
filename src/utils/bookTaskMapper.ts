import type { TaskItem } from "../types/studyPlan";

type BookSectionLike = {
  id: string;
  title?: string;
  startPage?: number;
  endPage?: number;
  videoEpisode?: string;
  videoTitle?: string;
  videoMin?: number;
};

type BookContextLike = {
  bookId?: string;
  bookName: string;
  subject: string;
  bigUnit?: string;
  smallUnit?: string;
  videoPlatform?: string;
  videoSeries?: string;
};

export function mapBookSectionToTask(
  section: BookSectionLike,
  ctx: BookContextLike
): TaskItem {
  const hasVideo = !!section.videoTitle?.trim();
  const hasPage =
    section.startPage !== undefined || section.endPage !== undefined;

  let taskMode: TaskItem["taskMode"] = "task";

  if (hasVideo && hasPage) taskMode = "lecture+book";
  else if (hasVideo) taskMode = "lecture";
  else if (hasPage) taskMode = "book";

 const episodeText = section.videoEpisode?.trim()
  ? `<${section.videoEpisode.trim()}>`
  : "";
const titleText = (section.title || "").trim();
const pageText =
  section.startPage !== undefined
    ? `${section.startPage}~${section.endPage ?? section.startPage}p`
    : "";

const oneLineTitle = [
  ctx.bookName,
  ctx.videoPlatform,
  ctx.videoSeries,
  [episodeText, titleText].filter(Boolean).join(" "),
  pageText,
]
  .filter(Boolean)
  .join(" · ");


  return {
    id: crypto.randomUUID(),

    sourceType: "book",
    subject: ctx.subject,
    taskMode,

    title: oneLineTitle,
    text: oneLineTitle,

    done: false,
    deleted: false,

    carriedOver: false,
    carriedFrom: "",

    lectureTitle: section.videoTitle || "",
    lectureDone: false,

    bookTitle: ctx.bookName,
    bookDone: false,

    pageStart: section.startPage,
    pageEnd: section.endPage,

    bigUnit: ctx.bigUnit || "",
    smallUnit: ctx.smallUnit || section.title || "",

    estimatedMin: section.videoMin,

    priority: 10,
    locked: false,

    bookId: ctx.bookId,
    sectionId: section.id,

    subtasks: [],
  };
}