/*
    Path: /user/[username]/profile/picture
    Purpose: Returns the profile picture for the user

*/

import { isValidName } from "../../../../modules/funcs.mjs";
import getUserID from "../../../../modules/getUserID.mjs";

export default async function userUsernameProfilePicture(req, res) {
    if (!isValidName(req.params.username)) {
        res.json({
            error: "The username supplied is not a valid scratch username",
        });
        return;
    }

    const id = await getUserID(req.params.username);
    res.redirect(
        302,
        `https://cdn2.scratch.mit.edu/get_image/user/${id}_60x60.png`
    );
}
