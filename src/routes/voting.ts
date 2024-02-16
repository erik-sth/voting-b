import express, { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { Contestant } from '../models/contestant';
import { Vote } from '../models/vote';
import { baseAccess } from '../middleware/baseAccess';
import { Project } from '../models/project';
import { isBetween } from '../utils/time';
import logger from '../utils/logger';

const router = express.Router();

router.post(
    '/:projectId/:contestantId',
    async (req: Request, res: Response) => {
        const { contestantId, projectId } = req.params;

        //validate
        if (!isValidObjectId(contestantId) || !isValidObjectId(projectId))
            return res.status(400).send('Invalid project or contestant Id.');
        //validating project existing
        const project = await Project.findById(projectId);
        if (!project) return res.status(400).send('This project doesnt exist.');
        //validating if votes are allowed

        if (!project.config.useTime && project.config.votingEnabled)
            return res
                .status(423)
                .send(
                    'Sorry, you cannot vote at the moment. Voting has been temporarily locked by the administrator. Please try again later.'
                );

        if (
            project.config.useTime &&
            !isBetween(
                new Date(project.config.votingStartDayAndTime),
                new Date(project.config.votingEndDayAndTime),
                new Date()
            )
        ) {
            const day = project.config.votingStartDayAndTime.getDate();
            const time = project.config.votingStartDayAndTime.getTime();
            return res
                .status(423)
                .send(
                    `No Votes Allowed at the Moment. Votes beginn ${day} at ${time}`
                );
        }

        //validating if contestant exists
        const contestant = await Contestant.findById(contestantId);
        if (!contestant)
            return res.status(400).send('This contestant doesnt exist.');

        const publicIp = req.headers['x-forwarded-for'];
        const firstIp =
            typeof publicIp === 'string' && publicIp
                ? publicIp.split(',')[0]
                : 'noIp';

        //check for ips
        if (project.config.limitVotesToOnePerIp) {
            const checkVote = await Vote.findOne({
                publicIpAddress: firstIp,
                gender: contestant.gender,
                projectId: projectId,
            });

            if (checkVote)
                return res.status(403).send('IpAddress already voted');

            // Check for cookie
            const cookies = req.cookies;
            const hasVotedCookie = cookies
                ? cookies['voted' + projectId + contestant.gender]
                : undefined;

            if (hasVotedCookie) {
                logger.info('Blocked by cookie');
                return res.status(403).send('Vote already submitted');
            }
        }

        //all checks pass increase vote and create vote
        contestant.countedVotes += 1;
        await contestant.save();

        const vote = new Vote({
            contestandId: contestantId,
            projectId: projectId,
            publicIpAddress: firstIp,
            gender: contestant.gender,
        });
        await vote.save();
        res.cookie('voted' + projectId + contestant.gender, 'true', {
            secure: true,
            httpOnly: true,
        });
        res.status(201).send('Voted!');
    }
);

router.get('/:projectId', baseAccess, async (req: Request, res: Response) => {
    const votes = await Vote.find({ projectId: req.params.projectId });
    res.send({ results: votes, count: votes.length });
});

export default router;
