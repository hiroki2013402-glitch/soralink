import CreatePost from "../../components/CreatePost";
import type { NewPost } from "../../components/CreatePost";
import type { User } from "../../types";

type Props = {
  user: User;
  onCreate: (input: NewPost) => Promise<void>;
};

// Create tab: the post composer.
export default function CreatePage({ user, onCreate }: Props) {
  return (
    <section className="x-page">
      <header className="x-page-head"><h1>投稿を作成</h1></header>
      <CreatePost user={user} onCreate={onCreate} />
    </section>
  );
}
