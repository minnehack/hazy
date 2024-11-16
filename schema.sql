drop table if exists registrations;
create table registrations (
    id serial primary key,

    email text not null,
    name text not null,
    gender text not null,
    phone text not null,
    country text not null,
    school text not null,
    level_of_study text not null,
    age int not null,
    tshirt text not null,
    driving boolean not null,

    discord_tag text,

    reimbursement boolean not null,
    reimbursement_amount real,
    reimbursement_desc text,
    reimbursement_strict boolean,

    accomodations text not null default '',
    dietary_restrictions text not null default '',

    registration_code text not null,
    registered_at datetime not null default current_timestamp,

    resume_filename text,

    checked_in boolean not null default false,
    checked_in_at datetime default null
);

