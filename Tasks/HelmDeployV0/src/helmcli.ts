import path = require("path");
import tl = require("azure-pipelines-task-lib/task");
import fs = require("fs");
import util = require("util");
import os = require("os");
import * as tr from "azure-pipelines-task-lib/toolrunner";
import basecommand from "./basecommand";

export default class helmcli extends basecommand {

    private command: string;
    private arguments: string[] = [];

    constructor() {
        super(true)
    }

    public getTool(): string {
        return "helm";
    }

    public login(): void {

    }

    public logout(): void {

    }

    public setCommand(command: string): void {
        this.command = command;
    }

    public getCommand(): string {
        return this.command;
    }

    public addArgument(argument: string): void {
        this.arguments.push(argument);
    }

    public getArguments(): string[] {
        return this.arguments;
    }

    public execHelmCommand(): tr.IExecSyncResult {
        var command = this.createCommand();
        command.arg(this.command);
        this.arguments.forEach((value) => {
            command.line(value);
        });

        return this.execCommandSync(command);
    }
}
