


export type TaskMode = "task" | "lecture" | "book" | "lecture+book";
export type TaskSourceType = "manual" | "book" | "exam";

export type TaskSubItem = {
  text: string;
  done: boolean;
};

export type TaskItem = {
  id?: string;
  text?: string;
  title?: string;
  done: boolean;
  deleted?: boolean;
  carriedOver?: boolean;
  carriedFrom?: string;
  subtasks?: TaskSubItem[];
  sourceType?: TaskSourceType;
  subject?: string;
  taskMode?: TaskMode;
  lectureTitle?: string;
  lectureDone?: boolean;
  bookTitle?: string;
  bookDone?: boolean;
  pageStart?: number;
  pageEnd?: number;
  bigUnit?: string;
  smallUnit?: string;
  estimatedMin?: number;
  priority?: number;
  locked?: boolean;
  bookId?: string;
  sectionId?: string;
};