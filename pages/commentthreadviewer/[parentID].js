function CommentDisplay(props) {
	return (
		<tr>
			<th>
				<img
					src={`/profilepicture/v1/${props.comment.username}`}
					style={{ maxWidth: "64px" }}
				></img>
			</th>
			<th>{props.comment.username}</th>
			<td>{props.comment.text}</td>
			<td>{new Date(props.comment.date).toISOString()}</td>
		</tr>
	);
}

export default function commentthreadviewer({ Comments }) {
	if (Comments.length === 0) {
		Comments[0] = {
			username: "herohamp",
			usernameID: "9565102",
			commentID: "-1",
			date: new Date().valueOf(),
			text:
				"I am sorry, that comment thread either does not exist or is not indexed",
			parent: "-1",
		};
	}
	return (
		<div>
			<link
				rel="stylesheet"
				href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css"
				integrity="sha384-Gn5384xqQ1aoWXA+058RXPxPg6fy4IWvTNh0E263XmFcJlSAwiGgFAW/dAiS6JXm"
				crossOrigin="anonymous"
			/>
			<div className="container">
				<br />
				<h3>
					Comment thread ID {Comments[0].parentID} on{" "}
					{Comments[0].profile}'s Profile
				</h3>
				<table className="table">
					<tbody>
						{Comments.map((comment) => {
							return (
								<CommentDisplay
									comment={comment}
									key={comment.commentID}
								/>
							);
						})}
					</tbody>
				</table>

				<div>
					CommentThreadViewer and the FluffyScratch API that powers it
					was made with {`<3`} by{" "}
					<a href="https://hamptonmoore.com">Hampton Moore</a>
				</div>
			</div>
		</div>
	);
}
import { Comment } from "../../modules/db.mjs";

export async function getServerSideProps(context) {

	const response = await Comment.findAll({
		where: {
			parentID: context.params.parentID,
		},
	});

	let Comments = [];

	for (let comment of response){
		let commentSet = comment.dataValues;
		delete commentSet.createdAt;
		delete commentSet.updatedAt;
		commentSet.username = commentSet.username.replace("*", "");
		Comments.push(commentSet);
	}


	return {
		props: { Comments: Comments }, // will be passed to the page component as props
	};
}
