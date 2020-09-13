import express from "express";
import queue from "../modules/queue.mjs";
import cheerio from "cheerio";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Sequelize from "sequelize";
const Op = Sequelize.Op;
import {
    SCAN_PROFILES,
    MAX_SCAN_TIMEOUT,
    MAX_COMMENT_PAGE,
} from "../modules/consts.mjs";
import { Comment } from "../modules/db.mjs";
import isValidName from "../modules/isValidName.mjs";
import { performance } from 'perf_hooks';

dotenv.config();

var router = express.Router();

import { User } from "../modules/db.mjs";

const convertCommentToJSON = function (comment, head) {
    let obj = {
        username: comment.find("div.name").text().trim(),
        usernameID: comment
            .find("img.avatar")
            .attr("src")
            .split("user/")[1]
            .split("_")[0],
        commentID: comment.attr("data-comment-id"),
        date: new Date(comment.find("span.time").attr("title")).valueOf(),
        text: comment
            .find("div.content")
            .text()
            .trim()
            .replaceAll("\n      \n      \n       ", "")
            .substring(0, 1024),
    };

    if (head) {
        obj.replies = [];
    } else {
        obj.parent = comment.find("a.reply").attr("data-parent-thread");
    }

    return obj;
};

const collectCommentsFromProfile = (username, page) => {
    return new Promise((resolve) => {
        queue
            .add(
                queue.TYPES.ProfileCommentCollector,
                {
                    username: username,
                    page: page,
                },
                queue.queues.asap
            )
            .then((html) => {
                const $ = cheerio.load(html);
                let comments = [];

                $("li.top-level-reply").each(function (index) {
                    let elm = $(this);
                    let headComment = convertCommentToJSON(
                        elm.find("div.comment").first(),
                        true
                    );

                    elm.find("ul.replies")
                        .find("div.comment")
                        .each((index, comment) => {
                            headComment.replies.push(
                                convertCommentToJSON($(comment), false)
                            );
                        });

                    comments.push(headComment);
                });

                resolve(comments);
            });
    });
};

router.get("/tojson/v1/:username/", (req, res) => {
    res.redirect(`/profilecomments/tojson/v1/${req.params.username}/1`);
});

router.get("/tojson/v1/:username/:page", (req, res) => {
    if (!isValidName(req.params.username)) {
        res.json({
            error: "The username supplied is not a valid scratch username",
        });
        return;
    }

    let { username, page } = req.params;

    if (
        isNaN(Number(page)) ||
        Number(page) <= 0 ||
        Number(page) > MAX_COMMENT_PAGE
    ) {
        res.json({
            error: `Page number is invalid, page numbers must be a valid number between 1 and ${MAX_COMMENT_PAGE}`,
        });
        return;
    }

    collectCommentsFromProfile(username, page).then((data) => {
        res.json(data);
    });
});

function commentObjectToCommentDBObject(comment, profile) {
    let parentID = -1;
    if (comment.replies) {
        if (comment.replies.length > 0) {
            parentID = comment.commentID;
        }
    } else if (comment.parent) {
        parentID = comment.parent;
    }
    return {
        username: comment.username,
        date: comment.date,
        text: comment.text,
        parentID: parentID,
        profile: profile,
        commentID: comment.commentID,
    };
}

function saveCommentPageToDB(page, profile) {
    return new Promise((resolve, reject) => {
        let comments = [];

        for (let thread of page) {
            comments.push(commentObjectToCommentDBObject(thread, profile));
            for (let child of thread.replies) {
                comments.push(commentObjectToCommentDBObject(child, profile));
            }
        }

        if (comments.length == 0) {
            resolve();
            return;
        }

        Comment.bulkCreate(comments, {
            updateOnDuplicate: ["text", "parentID"],
        })
            .then(() => {
                resolve();
            })
            .catch((err) => {
                console.log(comments);
                console.log(err);
                resolve();
            });
    });
}

function getProfileCommentStats(profile) {
    return new Promise((resolve, reject) => {
        let comments = Comment.findAll({
            where: {
                profile: profile,
            },
        });

        Promise.all([comments])
            .then(([comments]) => {
                let start = performance.now();
                let stats = {
                    oldestComment: new Date().valueOf(),
                    milisecondsPerComment: 0,
                    commentCount: 0,
                    threads: {},
                    commentors: {},
                };

                for (let comment of comments) {
                    stats.commentCount++;

                    if (stats.commentors.hasOwnProperty(comment.username)) {
                        stats.commentors[comment.username] += 1;
                    } else {
                        stats.commentors[comment.username] = 1;
                    }

                    if (
                        stats.threads.hasOwnProperty(comment.parentID) &&
                        comment.parentID > -1
                    ) {
                        stats.threads[comment.parentID] += 1;
                    } else {
                        stats.threads[comment.parentID] = 1;
                    }

                    if (comment.date < stats.oldestComment) {
                        stats.oldestComment = comment.date;
                    }
                }

                stats.milisecondsPerComment =
                    (new Date().valueOf() - stats.oldestComment) /
                    stats.commentCount;


                stats.topCommentors = Object.entries(stats.commentors).sort((a, b) => b[1] - a[1]).slice(0, 5);

                stats.topThreads = Object.entries(stats.threads).sort((a, b) => b[1] - a[1]).slice(0, 5);

                delete stats.commentors;
                delete stats.threads;

                stats.computeTime = performance.now() - start;

                resolve(stats);
            })
            .catch((err) => {
                console.log(err);
                reject(err);
            });
    });
}

router.get("/stats/v1/:profile/", (req, res) => {
    getProfileCommentStats(req.params.profile).then((data) => {
        res.json(data);
    });
});

router.get("/rawcomments/v1/:profile", (req, res) => {
    Comment.findAll({
        where: {
            profile: req.params.profile,
        },
    }).then((data) => {
        res.json(data);
    });
});

router.get("/scrapeuser/v1/:username/status", (req, res) => {
    const username = req.params.username;

    User.findOne({
        where: {
            username,
        },
    }).then((user) => {
        let msg;
        if (user.get("scanning") > 0) {
            msg = `${username} is still being scraped`;
        } else if (user.get("lastScrape") === -1) {
            msg = `${username} has never been scraped or had a scrape requested`;
        } else {
            msg = `${username} finished being scraped on ${new Date(
                user.get("lastScrape")
            )}`;
        }

        res.json({ msg });
    });
});

router.get("/scrapeuser/v1/:username", (req, res) => {
    if (!isValidName(req.params.username)) {
        res.json({
            error: "The username supplied is not a valid scratch username",
        });
        return;
    }

    const username = req.params.username;
    User.findOrCreate({
        where: { username: username },
        defaults: {
            username: username,
        },
    }).then(([user, created]) => {
        if (user.nextScrape < new Date().valueOf()) {
            res.json({
                msg: `${username} is being scraped, you can see the progress at the link below`,
                link: `/profilecomments/scrapeuser/v1/${username}/status`,
            });
            scrapeWholeProfile(username, 1);
        } else {
            res.json({
                msg: `${username} was already scraped on ${new Date(
                    user.lastScrape
                )}, next scrape is at ${new Date(user.nextScrape)}`,
                nextScrape: user.nextScrape,
                lastScrape: user.lastScrape,
            });
        }
    });
});

function scrapeWholeProfile(username, currentPage) {
    return new Promise((resolve) => {
        if (currentPage <= 0) {
            currentPage = 1;
        } else if (currentPage > MAX_COMMENT_PAGE) {
            resolve("Finished Scrape by hitting max");
            return;
        }

        User.update(
            { scanning: currentPage },
            {
                where: {
                    username: username,
                },
            }
        );

        let pageScrapes = [];
        for (let i = 0; i < 10; i++) {
            let newPage = currentPage + i;
            if (newPage > MAX_COMMENT_PAGE) {
                break;
            }
            pageScrapes.push(collectCommentsFromProfile(username, newPage));
        }

        Promise.all(pageScrapes).then((pageScrapes) => {
            let pageSaves = [];
            for (let page of pageScrapes) {
                if (page.length === 0) {
                    continue;
                }
                pageSaves.push(saveCommentPageToDB(page, username));
            }

            Promise.all(pageSaves)
                .then(() => {
                    if (pageSaves.length < 10) {
                        return scrapeWholeProfile(
                            username,
                            MAX_COMMENT_PAGE + 69420
                        );
                    }
                    return scrapeWholeProfile(username, currentPage + 10);
                })
                .then((message) => {
                    // We only want the rest of this running on the base
                    if (currentPage != 1) {
                        resolve();
                    }
                    return calculateNextScan(username);
                })
                .then(() => {
                    resolve();
                });
        });
    });
}

function calculateNextScan(username) {
    new Promise((resolve, reject) => {
        getProfileCommentStats(username).then((stats) => {
            const date = new Date().valueOf();
            let nextScrape = date + stats.milisecondsPerComment * 20;
            let longest = date + MAX_SCAN_TIMEOUT;
            if (stats.milisecondsPerComment == null || nextScrape > longest) {
                nextScrape = longest;
            }
            return User.update(
                {
                    lastScrape: date,
                    nextScrape: nextScrape,
                    fullScanned: true,
                    scanning: 0,
                },
                {
                    where: {
                        username: username,
                    },
                }
            );
        });
    });
}

function scanProfiles() {
    User.findOne({
        where: {
            nextScrape: { [Op.lt]: new Date().valueOf() },
            id: { [Op.gt]: -1 },
            scanning: 0,
        },
        order: [Sequelize.literal("createdAt ASC")],
    }).then((user) => {
        if (user === null) {
            return;
        }

        let username = user.get("username");
        console.log("Started Scan of " + username + " at " + new Date());

        user.set("scanning", 1);
        user.save();
        if (user.get("fullScanned") == false) {
            scrapeWholeProfile(username, 1);
        } else {
            let pages = [];

            collectCommentsFromProfile(username, 1)
                .then((comments) => {
                    return saveCommentPageToDB(comments, username);
                })
                .then(() => {
                    return collectCommentsFromProfile(username, 2);
                })
                .then((comments) => {
                    return saveCommentPageToDB(comments, username);
                })
                .then(() => {
                    calculateNextScan(username);
                });
        }
    });
}

if (process.env.DEPLOYED === "hubble") {
    setInterval(scanProfiles, SCAN_PROFILES);
}

export default router;
